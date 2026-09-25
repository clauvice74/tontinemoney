import { Inject, Injectable } from '@nestjs/common';
import {
  Clock,
  MEMBER_QUERY,
  type MemberQueryPort,
  OutboxService,
  PrismaService,
  ScheduledJob,
  UnitOfWork,
} from '@tontine/platform';
import { AmlScreeningProvider } from './providers/providers';

interface Warnings {
  d30?: boolean;
  d7?: boolean;
  expired?: boolean;
  suspended?: boolean;
}

const DAY = 86_400_000;
const LOWER: Record<string, string> = {
  TIER_3: 'TIER_2',
  TIER_2: 'TIER_1',
  TIER_1: 'TIER_1',
  NONE: 'NONE',
};

/** Expiration des pièces (US-3.6) et screening AML quotidien des membres actifs (US-3.5 §2). */
@Injectable()
export class KycMaintenanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly aml: AmlScreeningProvider,
    @Inject(MEMBER_QUERY) private readonly members: MemberQueryPort,
  ) {}

  /**
   * J-30 avertissement (email + in-app), J-7 rappel urgent (SMS + email), J-0 statut EXPIRED et
   * niveau abaissé d'un palier (A-29 : TIER_2 conservé pendant 30 jours de grâce), J+30 opérations
   * financières suspendues (niveau TIER_1).
   */
  @ScheduledJob({
    name: 'kyc.expiry',
    cron: '0 0 6 * * *',
    description: 'Expiration et renouvellement des pièces d’identité (US-3.6)',
  })
  async processExpirations(): Promise<{ warned: number; expired: number; suspended: number }> {
    const today = new Date(`${this.clock.today()}T00:00:00Z`);
    const horizon = new Date(today.getTime() + 30 * DAY);
    const due = await this.prisma.kycRequest.findMany({
      where: {
        documentExpiresAt: { not: null, lte: horizon },
        OR: [{ status: 'VERIFIED' }, { status: 'EXPIRED' }],
      },
    });
    let warned = 0;
    let expired = 0;
    let suspended = 0;
    for (const r of due) {
      const w = (r.expiryWarnings ?? {}) as Warnings;
      const daysLeft = Math.round((r.documentExpiresAt!.getTime() - today.getTime()) / DAY);
      const member = await this.members.snapshot(r.memberId);
      // Une demande plus récente vérifiée (renouvellement) clôt le cycle d'expiration
      const renewed = await this.prisma.kycRequest.count({
        where: { memberId: r.memberId, status: 'VERIFIED', submittedAt: { gt: r.submittedAt } },
      });
      if (renewed > 0 || !member) continue;
      await this.uow.run(async (tx) => {
        if (r.status === 'VERIFIED' && daysLeft > 7 && daysLeft <= 30 && !w.d30) {
          w.d30 = true;
          warned++;
          await this.outbox.add(tx, {
            type: 'kyc.expiring',
            aggregateType: 'kyc_request',
            aggregateId: r.id,
            payload: { memberId: r.memberId, requestId: r.id, daysLeft },
          });
        } else if (r.status === 'VERIFIED' && daysLeft > 0 && daysLeft <= 7 && !w.d7) {
          w.d7 = true;
          w.d30 = true;
          warned++;
          await this.outbox.add(tx, {
            type: 'kyc.expiring',
            aggregateType: 'kyc_request',
            aggregateId: r.id,
            payload: { memberId: r.memberId, requestId: r.id, daysLeft },
          });
        } else if (r.status === 'VERIFIED' && daysLeft <= 0) {
          w.expired = true;
          expired++;
          const newLevel = member.kycLevel === 'TIER_3' ? 'TIER_2' : member.kycLevel;
          await tx.kycRequest.update({ where: { id: r.id }, data: { status: 'EXPIRED' } });
          await this.outbox.add(tx, {
            type: 'kyc.expired',
            aggregateType: 'kyc_request',
            aggregateId: r.id,
            payload: {
              memberId: r.memberId,
              requestId: r.id,
              expirationDate: r.documentExpiresAt!.toISOString().slice(0, 10),
              newLevel,
            },
          });
        } else if (r.status === 'EXPIRED' && daysLeft <= -30 && !w.suspended) {
          w.suspended = true;
          suspended++;
          await this.outbox.add(tx, {
            type: 'kyc.expired',
            aggregateType: 'kyc_request',
            aggregateId: r.id,
            payload: {
              memberId: r.memberId,
              requestId: r.id,
              expirationDate: r.documentExpiresAt!.toISOString().slice(0, 10),
              newLevel:
                LOWER[member.kycLevel === 'TIER_3' ? 'TIER_2' : member.kycLevel] ?? 'TIER_1',
            },
          });
          await this.outbox.add(tx, {
            type: 'kyc.operations.suspended',
            aggregateType: 'kyc_request',
            aggregateId: r.id,
            payload: { memberId: r.memberId, requestId: r.id },
          });
        }
        await tx.kycRequest.update({ where: { id: r.id }, data: { expiryWarnings: w as object } });
      });
    }
    return { warned, expired, suspended };
  }

  /** US-3.5 — nouveau screening quotidien : nouvelles entrées des listes → revue humaine (jamais de rejet auto). */
  @ScheduledJob({
    name: 'kyc.aml-batch',
    cron: '0 30 3 * * *',
    description: 'Screening AML quotidien des membres actifs (US-3.5)',
  })
  async amlBatch(): Promise<{ screened: number; newMatches: number }> {
    const active = await this.prisma.member.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, firstName: true, lastName: true, dateOfBirth: true },
    });
    let newMatches = 0;
    for (const m of active) {
      const hits = await this.aml.screen(
        `${m.firstName} ${m.lastName}`,
        m.dateOfBirth?.toISOString().slice(0, 10) ?? null,
      );
      for (const h of hits) {
        const known = await this.prisma.kycAmlMatch.findFirst({
          where: {
            memberId: m.id,
            listName: h.listName,
            entryId: h.entryId,
            status: { in: ['OPEN', 'CONFIRMED'] },
          },
        });
        const white = await this.prisma.kycAmlWhitelist.findUnique({
          where: {
            memberId_listName_entryId: { memberId: m.id, listName: h.listName, entryId: h.entryId },
          },
        });
        if (known || white) continue;
        await this.uow.run(async (tx) => {
          const match = await tx.kycAmlMatch.create({
            data: {
              memberId: m.id,
              listName: h.listName,
              entryId: h.entryId,
              entryName: h.entryName,
              entryCountry: h.entryCountry,
              entryReason: h.entryReason,
              entryAddedAt: new Date(`${h.entryAddedAt}T00:00:00Z`),
              score: h.score,
              source: 'BATCH',
            },
          });
          await this.outbox.add(tx, {
            type: 'kyc.aml.match',
            aggregateType: 'member',
            aggregateId: m.id,
            payload: { memberId: m.id, matchId: match.id, listName: h.listName, score: h.score },
          });
        });
        newMatches++;
      }
    }
    return { screened: active.length, newMatches };
  }

  /**
   * A-18 — politique de rétention : recense les dossiers KYC dont la durée de conservation (7 ans)
   * est échue. Mode « dry-run » uniquement en V1 : aucune suppression automatique (décision
   * juridique et purge sécurisée du stockage à valider avant production).
   */
  @ScheduledJob({
    name: 'kyc.retention-dry-run',
    cron: '0 0 4 * * 0',
    description: 'Rétention KYC : recensement des dossiers échus (dry-run, aucune suppression)',
  })
  async retentionDryRun(): Promise<{ expiredRequests: number; documents: number; dryRun: true }> {
    const now = this.clock.now();
    const requests = await this.prisma.kycRequest.findMany({
      where: { retentionUntil: { lt: now } },
      select: { id: true },
    });
    const documents = requests.length
      ? await this.prisma.kycDocument.count({
          where: { requestId: { in: requests.map((r) => r.id) } },
        })
      : 0;
    return { expiredRequests: requests.length, documents, dryRun: true };
  }
}
