import { Injectable } from '@nestjs/common';
import { type KycDecisionInput } from '@tontine/contracts';
import { type KycRequest } from '@tontine/database';
import { type Actor, AuditService, Clock, DomainError, OutboxService, PrismaService, UnitOfWork } from '@tontine/platform';

/** Revue manuelle par un agent KYC (US-3.3), doublons (US-3.4) et correspondances AML (US-3.5). */
@Injectable()
export class KycReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  /** File des dossiers à revoir, triés par ancienneté, avec l'échéance SLA (24 h ouvrées). */
  async queue(status: 'REVIEW_REQUIRED' | 'SUPPLEMENT_REQUESTED' = 'REVIEW_REQUIRED') {
    const rows = await this.prisma.kycRequest.findMany({
      where: { status },
      orderBy: { submittedAt: 'asc' },
      take: 200,
      include: { checks: { select: { step: true, outcome: true, score: true } } },
    });
    const members = await this.prisma.member.findMany({
      where: { id: { in: rows.map((r) => r.memberId) } },
      select: { id: true, firstName: true, lastName: true, countryCode: true },
    });
    const byId = new Map(members.map((m) => [m.id, m]));
    const now = this.clock.now();
    return {
      data: rows.map((r) => ({
        id: r.id,
        memberId: r.memberId,
        member: byId.get(r.memberId) ?? null,
        targetLevel: r.targetLevel,
        documentType: r.documentType,
        submittedAt: r.submittedAt.toISOString(),
        slaDueAt: r.slaDueAt?.toISOString() ?? null,
        slaBreached: !!r.slaDueAt && r.slaDueAt < now,
        flags: r.checks.filter((c) => c.outcome !== 'PASS').map((c) => ({ step: c.step, outcome: c.outcome, score: c.score })),
      })),
    };
  }

  async detail(requestId: string) {
    const r = await this.prisma.kycRequest.findUnique({
      where: { id: requestId },
      include: { documents: true, checks: { orderBy: { createdAt: 'asc' } }, agentActions: { orderBy: { createdAt: 'asc' } } },
    });
    if (!r) throw new DomainError('NOT_FOUND', 'Dossier introuvable');
    const [member, duplicates, amlMatches, previous] = await Promise.all([
      this.prisma.member.findUnique({ where: { id: r.memberId } }),
      this.prisma.kycDuplicateAlert.findMany({ where: { OR: [{ requestId: r.id }, { memberId: r.memberId, status: 'OPEN' }] } }),
      this.prisma.kycAmlMatch.findMany({ where: { OR: [{ requestId: r.id }, { memberId: r.memberId, status: 'OPEN' }] } }),
      this.prisma.kycRequest.findMany({ where: { memberId: r.memberId, id: { not: r.id } }, orderBy: { submittedAt: 'desc' } }),
    ]);
    return {
      id: r.id,
      status: r.status,
      targetLevel: r.targetLevel,
      documentType: r.documentType,
      documentCountry: r.documentCountry,
      documentExpiresAt: r.documentExpiresAt?.toISOString().slice(0, 10) ?? null,
      incomeSource: r.incomeSource,
      submittedAt: r.submittedAt.toISOString(),
      slaDueAt: r.slaDueAt?.toISOString() ?? null,
      extracted: r.extracted,
      member: member
        ? { id: member.id, firstName: member.firstName, lastName: member.lastName, dateOfBirth: member.dateOfBirth?.toISOString().slice(0, 10) ?? null, country: member.countryCode, status: member.status, kycLevel: member.kycLevel }
        : null,
      documents: r.documents.map((d) => ({ id: d.id, kind: d.kind, mimeType: d.mimeType, width: d.width, height: d.height, sizeBytes: d.sizeBytes, url: `/api/v1/kyc/documents/${d.id}` })),
      checks: r.checks.map((c) => ({ step: c.step, outcome: c.outcome, score: c.score, details: c.details, durationMs: c.durationMs, attempts: c.attempts })),
      alerts: {
        duplicates: duplicates.map((d) => ({ id: d.id, duplicateOfMemberId: d.duplicateOfMemberId, similarityScore: d.similarityScore, status: d.status })),
        aml: amlMatches.map((m) => ({ id: m.id, listName: m.listName, entryName: m.entryName, entryCountry: m.entryCountry, entryReason: m.entryReason, entryAddedAt: m.entryAddedAt?.toISOString().slice(0, 10) ?? null, score: m.score, status: m.status })),
      },
      previousSubmissions: previous.map((p) => ({ id: p.id, status: p.status, submittedAt: p.submittedAt.toISOString(), rejectCategory: p.rejectCategory, rejectReason: p.rejectReason })),
      actions: r.agentActions.map((a) => ({ agentId: a.agentId, action: a.action, category: a.category, comment: a.comment, createdAt: a.createdAt.toISOString() })),
    };
  }

  /** Décision de l'agent : accepter (annotation ≥ 10 car.), rejeter (catégorie + commentaire), compléments. */
  async decide(actor: Actor, requestId: string, input: KycDecisionInput): Promise<KycRequest> {
    const r = await this.prisma.kycRequest.findUnique({ where: { id: requestId } });
    if (!r) throw new DomainError('NOT_FOUND', 'Dossier introuvable');
    if (r.status !== 'REVIEW_REQUIRED') throw new DomainError('INVALID_STATE_TRANSITION', `Dossier ${r.status} : aucune décision possible`);
    const now = this.clock.now();
    return this.uow.run(async (tx) => {
      const claimed = await tx.kycRequest.updateMany({
        where: { id: r.id, status: 'REVIEW_REQUIRED' },
        data:
          input.action === 'APPROVE'
            ? { status: 'VERIFIED', decidedBy: actor.userId, decidedAt: now }
            : input.action === 'REJECT'
              ? { status: 'REJECTED', decidedBy: actor.userId, decidedAt: now, rejectCategory: input.category, rejectReason: input.comment }
              : { status: 'SUPPLEMENT_REQUESTED', decidedBy: actor.userId, decidedAt: now },
      });
      if (claimed.count !== 1) throw new DomainError('CONFLICT', 'Dossier déjà traité');
      await tx.kycAgentAction.create({
        data: {
          requestId: r.id,
          agentId: actor.userId,
          action: input.action,
          category: input.action === 'REJECT' ? input.category : null,
          comment: input.action === 'APPROVE' ? input.annotation : input.comment,
          createdAt: now,
        },
      });
      await this.audit.record({ action: `kyc.review.${input.action.toLowerCase()}`, resourceType: 'kyc_request', resourceId: r.id, result: 'SUCCESS' }, tx);
      if (input.action === 'APPROVE') {
        // L'agent confirme l'absence de correspondance : liste blanche des faux positifs (US-3.5 §5)
        const open = await tx.kycAmlMatch.findMany({ where: { memberId: r.memberId, status: 'OPEN' } });
        for (const m of open) {
          await tx.kycAmlMatch.update({ where: { id: m.id }, data: { status: 'DISMISSED', resolvedBy: actor.userId, resolvedAt: now, resolutionComment: input.annotation } });
          await tx.kycAmlWhitelist.upsert({
            where: { memberId_listName_entryId: { memberId: r.memberId, listName: m.listName, entryId: m.entryId } },
            create: { memberId: r.memberId, listName: m.listName, entryId: m.entryId, confirmedBy: actor.userId, comment: input.annotation },
            update: {},
          });
        }
        await tx.kycDuplicateAlert.updateMany({ where: { requestId: r.id, status: 'OPEN' }, data: { status: 'DISMISSED', resolvedBy: actor.userId, resolvedAt: now, resolutionComment: input.annotation } });
        await this.outbox.add(tx, {
          type: 'kyc.verified',
          aggregateType: 'kyc_request',
          aggregateId: r.id,
          payload: { memberId: r.memberId, requestId: r.id, kycLevel: r.targetLevel, verifiedAt: now.toISOString(), verifiedBy: 'agent', documentCountry: r.documentCountry },
        });
      } else if (input.action === 'REJECT') {
        if (input.category === 'AML_MATCH_CONFIRME') {
          await tx.kycAmlMatch.updateMany({ where: { memberId: r.memberId, status: 'OPEN' }, data: { status: 'CONFIRMED', resolvedBy: actor.userId, resolvedAt: now, resolutionComment: input.comment } });
        }
        if (input.category === 'DOUBLON_CONFIRME') {
          await tx.kycDuplicateAlert.updateMany({ where: { requestId: r.id, status: 'OPEN' }, data: { status: 'CONFIRMED', resolvedBy: actor.userId, resolvedAt: now, resolutionComment: input.comment } });
        }
        await this.outbox.add(tx, {
          type: 'kyc.rejected',
          aggregateType: 'kyc_request',
          aggregateId: r.id,
          payload: { memberId: r.memberId, requestId: r.id, rejectCategory: input.category, rejectReason: input.comment, rejectedBy: 'agent' },
        });
      } else {
        await this.outbox.add(tx, {
          type: 'kyc.supplement.requested',
          aggregateType: 'kyc_request',
          aggregateId: r.id,
          payload: { memberId: r.memberId, requestId: r.id, message: input.comment },
        });
      }
      return tx.kycRequest.findUniqueOrThrow({ where: { id: r.id } });
    });
  }

  async duplicates(status: 'OPEN' | 'CONFIRMED' | 'DISMISSED' = 'OPEN') {
    const rows = await this.prisma.kycDuplicateAlert.findMany({ where: { status }, orderBy: { createdAt: 'asc' } });
    return {
      data: rows.map((d) => ({
        id: d.id,
        memberId: d.memberId,
        duplicateOfMemberId: d.duplicateOfMemberId,
        requestId: d.requestId,
        similarityScore: d.similarityScore,
        status: d.status,
        createdAt: d.createdAt.toISOString(),
        links: { newFile: `/api/v1/kyc/requests/${d.requestId}` },
      })),
    };
  }

  /** Résolution d'un doublon : confirmé → dossier rejeté ; écarté → le membre repasse en revue KYC. */
  async resolveDuplicate(actor: Actor, id: string, resolution: 'CONFIRMED' | 'DISMISSED', comment: string): Promise<void> {
    const alert = await this.prisma.kycDuplicateAlert.findUnique({ where: { id } });
    if (!alert) throw new DomainError('NOT_FOUND', 'Alerte introuvable');
    if (alert.status !== 'OPEN') throw new DomainError('INVALID_STATE_TRANSITION', 'Alerte déjà traitée');
    await this.prisma.kycDuplicateAlert.update({ where: { id }, data: { status: resolution, resolvedBy: actor.userId, resolvedAt: this.clock.now(), resolutionComment: comment } });
    if (resolution === 'CONFIRMED') {
      const req = await this.prisma.kycRequest.findUnique({ where: { id: alert.requestId } });
      if (req?.status === 'REVIEW_REQUIRED') await this.decide(actor, req.id, { action: 'REJECT', category: 'DOUBLON_CONFIRME', comment });
    } else {
      await this.uow.run((tx) =>
        this.outbox.add(tx, {
          type: 'kyc.duplicate.resolved',
          aggregateType: 'kyc_request',
          aggregateId: alert.requestId,
          payload: { memberId: alert.memberId, alertId: alert.id, resolution: 'DISMISSED' },
        }),
      );
    }
  }

  async amlMatches(status: 'OPEN' | 'CONFIRMED' | 'DISMISSED' = 'OPEN') {
    const rows = await this.prisma.kycAmlMatch.findMany({ where: { status }, orderBy: { createdAt: 'asc' } });
    return { data: rows.map((m) => ({ ...m, entryAddedAt: m.entryAddedAt?.toISOString().slice(0, 10) ?? null, createdAt: m.createdAt.toISOString(), resolvedAt: m.resolvedAt?.toISOString() ?? null })) };
  }

  /** US-3.5 : faux positif → liste blanche ; correspondance confirmée par un humain → suspension (conformité). */
  async resolveAml(actor: Actor, id: string, resolution: 'CONFIRMED_MATCH' | 'FALSE_POSITIVE', comment: string): Promise<void> {
    const m = await this.prisma.kycAmlMatch.findUnique({ where: { id } });
    if (!m) throw new DomainError('NOT_FOUND', 'Correspondance introuvable');
    if (m.status !== 'OPEN') throw new DomainError('INVALID_STATE_TRANSITION', 'Correspondance déjà traitée');
    const now = this.clock.now();
    await this.uow.run(async (tx) => {
      await tx.kycAmlMatch.update({
        where: { id },
        data: { status: resolution === 'FALSE_POSITIVE' ? 'DISMISSED' : 'CONFIRMED', resolvedBy: actor.userId, resolvedAt: now, resolutionComment: comment },
      });
      if (resolution === 'FALSE_POSITIVE') {
        await tx.kycAmlWhitelist.upsert({
          where: { memberId_listName_entryId: { memberId: m.memberId, listName: m.listName, entryId: m.entryId } },
          create: { memberId: m.memberId, listName: m.listName, entryId: m.entryId, confirmedBy: actor.userId, comment },
          update: {},
        });
      } else {
        await this.outbox.add(tx, {
          type: 'compliance.user.suspended',
          aggregateType: 'member',
          aggregateId: m.memberId,
          payload: { memberId: m.memberId, reason: `Correspondance ${m.listName} confirmée par un agent` },
        });
      }
    });
  }
}
