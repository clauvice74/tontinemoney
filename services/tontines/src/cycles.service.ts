import { Inject, Injectable, Logger } from '@nestjs/common';
import { moneyView } from '@tontine/contracts';
import { type Tontine, type TontineCycle, type TxClient } from '@tontine/database';
import {
  type Actor,
  AuditService,
  Clock,
  DomainError,
  MEMBER_QUERY,
  type MemberQueryPort,
  OutboxService,
  PrismaService,
  ScheduledJob,
  UnitOfWork,
  kycAtLeast,
} from '@tontine/platform';
import {
  type Frequency,
  type FrequencyDetail,
  addDays,
  cycleStartDate,
  dueDateForCycle,
  localDate,
} from './domain/calendar';
import { beneficiaryProof, draw, verifyDraw } from './domain/draw';
import { MIN_MEMBERS, TontinesService } from './tontines.service';

export interface DrawOrderRecord {
  memberIds: string[];
  seed?: string;
  algorithm?: string;
  proof?: string;
  drawnAt?: string;
}

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

/** Démarrage (US-4.3), échéances (US-4.4), bénéficiaires (US-4.6), vues des cycles. */
@Injectable()
export class CyclesService {
  private readonly logger = new Logger(CyclesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly tontines: TontinesService,
    @Inject(MEMBER_QUERY) private readonly members: MemberQueryPort,
  ) {}

  // ------------------------------------------------------------------ US-4.3 démarrage
  /** Liste des blocages empêchant le démarrage (vide = démarrable). */
  async startBlockers(t: Tontine): Promise<string[]> {
    const blockers: string[] = [];
    const seated = await this.prisma.tontineMember.findMany({
      where: { tontineId: t.id, status: { in: ['ACTIVE', 'SUSPENDED', 'PENDING_ACTIVATION'] } },
    });
    const active = seated.filter((m) => m.status === 'ACTIVE');
    if (active.length < MIN_MEMBERS)
      blockers.push(
        `Au moins ${MIN_MEMBERS} membres actifs requis (${active.length} actuellement)`,
      );
    const inactive = seated.length - active.length;
    if (inactive > 0)
      blockers.push(`${inactive} participant(s) non actif(s) (activation ou suspension en cours)`);
    const snaps = await this.members.snapshots(active.map((m) => m.memberId));
    const byId = new Map(snaps.map((s) => [s.id, s]));
    const kycKo = active.filter(
      (m) => !kycAtLeast(byId.get(m.memberId)?.kycLevel ?? 'NONE', 'TIER_2'),
    ).length;
    if (kycKo > 0) blockers.push(`${kycKo} membre(s) sans vérification d’identité de niveau 2`);
    const statusKo = active.filter((m) => byId.get(m.memberId)?.status !== 'ACTIVE').length;
    if (statusKo > 0) blockers.push(`${statusKo} membre(s) dont le compte n’est pas actif`);
    const feeKo = active.filter((m) => !m.entryFeePaid).length;
    if (t.entryFeeMinor > 0n && feeKo > 0) blockers.push(`${feeKo} droit(s) d’entrée non payé(s)`);
    if (t.drawMode === 'FIXED_ORDER') {
      const order = (t.drawOrder as DrawOrderRecord | null)?.memberIds ?? [];
      const ids = new Set(active.map((m) => m.memberId));
      if (order.length !== ids.size || !order.every((id) => ids.has(id)))
        blockers.push('Ordre de passage à définir par l’administrateur (mode ordre fixe)');
    }
    return blockers;
  }

  /** Tâche quotidienne : démarre les tontines READY dont la date de début est atteinte. */
  @ScheduledJob({
    name: 'tontines.start',
    cron: '0 5 * * * *',
    description:
      'Démarrage automatique des tontines prêtes dont la date est atteinte, vérifié chaque heure pour couvrir tous les fuseaux (US-4.3)',
  })
  async startDue(): Promise<{ started: number; blocked: number }> {
    const candidates = await this.prisma.tontine.findMany({
      where: {
        status: { in: ['READY', 'DRAFT'] },
        startDate: { lte: d(addDays(iso(this.clock.now()), 1)) },
      },
    });
    let started = 0;
    let blocked = 0;
    for (const t of candidates) {
      if (t.startDate > d(localDate(t.timezone, this.clock.now()))) continue;
      const r = await this.tryStart(t.id);
      if (r.started) started++;
      else blocked++;
    }
    if (started || blocked)
      this.logger.log(`Démarrage des tontines : ${started} démarrée(s), ${blocked} bloquée(s)`);
    return { started, blocked };
  }

  /** Démarrage manuel par l'admin : uniquement si la date de début est atteinte (fuseau de la tontine). */
  async startNow(t: Tontine): Promise<{ started: boolean; blockers: string[] }> {
    if (t.startDate > d(localDate(t.timezone, this.clock.now()))) {
      throw new DomainError(
        'BUSINESS_RULE_VIOLATION',
        `Démarrage possible à partir du ${iso(t.startDate)}`,
      );
    }
    return this.tryStart(t.id);
  }

  async tryStart(tontineId: string): Promise<{ started: boolean; blockers: string[] }> {
    const t = await this.prisma.tontine.findUniqueOrThrow({ where: { id: tontineId } });
    if (t.status !== 'READY' && t.status !== 'DRAFT')
      return { started: false, blockers: [`Statut ${t.status}`] };
    const blockers =
      t.status === 'DRAFT'
        ? [
            'La tontine n’est pas prête (moins de 3 membres confirmés)',
            ...(await this.startBlockers(t)),
          ]
        : await this.startBlockers(t);
    if (blockers.length) {
      const unique = [...new Set(blockers)];
      await this.uow.run(async (tx) => {
        await tx.tontine.update({
          where: { id: t.id },
          data: { lastStartCheckAt: this.clock.now() },
        });
        await this.outbox.add(tx, {
          type: 'tontine.start.blocked',
          aggregateType: 'tontine',
          aggregateId: t.id,
          payload: { tontineId: t.id, blockers: unique },
        });
      });
      return { started: false, blockers: unique };
    }
    await this.uow.run(
      async (tx) => {
        const [locked] = await tx.$queryRaw<
          Array<{ status: string }>
        >`SELECT "status"::text AS status FROM "ton_tontines" WHERE "id" = ${t.id}::uuid FOR UPDATE`;
        if (locked?.status !== 'READY')
          throw new DomainError('INVALID_STATE_TRANSITION', 'La tontine a changé d’état');
        const active = await tx.tontineMember.findMany({
          where: { tontineId: t.id, status: 'ACTIVE' },
          orderBy: { joinedAt: 'asc' },
        });
        const now = this.clock.now();
        let order: string[] = [];
        let record: DrawOrderRecord | null = null;
        if (t.drawMode === 'RANDOM') {
          const r = draw(
            t.id,
            active.map((m) => m.memberId),
            now,
          );
          order = r.order;
          record = {
            memberIds: r.order,
            seed: r.seedHex,
            algorithm: r.algorithm,
            proof: r.proof,
            drawnAt: r.drawnAt,
          };
          await tx.tontine.update({
            where: { id: t.id },
            data: { drawProof: r.proof, drawSeedHash: r.seedHash, drawnAt: now },
          });
        } else if (t.drawMode === 'FIXED_ORDER') {
          order = (t.drawOrder as unknown as DrawOrderRecord).memberIds;
          record = { memberIds: order };
        }
        for (const [i, memberId] of order.entries()) {
          await tx.tontineMember.update({
            where: { tontineId_memberId: { tontineId: t.id, memberId } },
            data: { position: i + 1 },
          });
        }
        await tx.tontine.update({
          where: { id: t.id },
          data: {
            status: 'ACTIVE',
            startedAt: now,
            totalCycles: active.length,
            currentCycleNumber: 1,
            drawOrder: record ? (record as object) : undefined,
            invitationLinkHash: null,
            invitationLinkExpires: null,
            version: { increment: 1 },
          },
        });
        await tx.tontineInvitation.updateMany({
          where: { tontineId: t.id, status: 'PENDING' },
          data: { status: 'EXPIRED' },
        });
        const fresh = await tx.tontine.findUniqueOrThrow({ where: { id: t.id } });
        const cycle = await this.openCycle(
          tx,
          fresh,
          1,
          order[0] ?? null,
          active.map((m) => m.memberId),
        );
        await this.outbox.add(tx, {
          type: 'tontine.started',
          aggregateType: 'tontine',
          aggregateId: t.id,
          payload: {
            tontineId: t.id,
            memberCount: active.length,
            firstBeneficiaryId: cycle.beneficiaryId,
            drawProof: record?.proof ?? null,
          },
        });
        await this.audit.record(
          {
            action: 'tontine.started',
            resourceType: 'tontine',
            resourceId: t.id,
            result: 'SUCCESS',
            metadata: { drawMode: t.drawMode, proof: record?.proof ?? null },
          },
          tx,
        );
      },
      { isolationLevel: 'Serializable', retries: 3 },
    );
    return { started: true, blockers: [] };
  }

  /**
   * Ouvre le cycle `n` : échéance calculée (US-4.4 §3), une contribution PENDING par membre actif,
   * événements `tontine.cycle.started` et `tontine.contribution.due`.
   */
  async openCycle(
    tx: TxClient,
    t: Tontine,
    n: number,
    beneficiaryId: string | null,
    memberIds: string[],
  ): Promise<TontineCycle> {
    const freq = t.frequency as Frequency;
    const detail = t.frequencyDetail as FrequencyDetail;
    const start = iso(t.startDate);
    const due = dueDateForCycle(freq, detail, start, n);
    const graceUntil = addDays(due, t.graceDays);
    const now = this.clock.now();
    const cycle = await tx.tontineCycle.create({
      data: {
        tontineId: t.id,
        number: n,
        status: 'IN_PROGRESS',
        beneficiaryId,
        startDate: d(cycleStartDate(freq, detail, start, n)),
        dueDate: d(due),
        expectedMinor: t.contributionMinor * BigInt(memberIds.length),
        beneficiaryProof: beneficiaryId
          ? beneficiaryProof(t.id, n, beneficiaryId, t.drawMode, now, t.drawProof ?? '')
          : null,
        startedAt: now,
        createdAt: now,
      },
    });
    await this.outbox.add(tx, {
      type: 'tontine.cycle.started',
      aggregateType: 'tontine',
      aggregateId: t.id,
      payload: { tontineId: t.id, cycleId: cycle.id, cycleNumber: n, beneficiaryId, dueDate: due },
    });
    for (const memberId of memberIds) {
      const c = await tx.contribution.create({
        data: {
          cycleId: cycle.id,
          tontineId: t.id,
          memberId,
          amountMinor: t.contributionMinor,
          dueDate: d(due),
          graceUntil: d(graceUntil),
          defaultAt: d(addDays(graceUntil, t.defaultAfterDays)),
          createdAt: now,
        },
      });
      await this.outbox.add(tx, {
        type: 'tontine.contribution.due',
        aggregateType: 'tontine',
        aggregateId: t.id,
        payload: {
          tontineId: t.id,
          cycleId: cycle.id,
          contributionId: c.id,
          memberId,
          amountMinor: t.contributionMinor.toString(),
          currency: t.currency,
          dueDate: due,
        },
      });
    }
    return cycle;
  }

  // ------------------------------------------------------------------ US-4.6 bénéficiaires
  /** FIXED_ORDER : l'admin définit l'ordre ; après démarrage, seuls les cycles futurs changent (R-TON-08). */
  async setDrawOrder(actor: Actor, tontineId: string, memberIds: string[]) {
    const t = await this.tontines.getAdministered(actor, tontineId, false);
    if (t.drawMode !== 'FIXED_ORDER')
      throw new DomainError(
        'BUSINESS_RULE_VIOLATION',
        'Ordre de passage réservé au mode « ordre fixe »',
      );
    if (new Set(memberIds).size !== memberIds.length)
      throw new DomainError('VALIDATION_FAILED', 'Un membre apparaît plusieurs fois');
    const active = await this.prisma.tontineMember.findMany({
      where: { tontineId: t.id, status: { in: ['ACTIVE', 'SUSPENDED'] } },
    });
    if (t.status === 'DRAFT' || t.status === 'READY') {
      const ids = new Set(active.filter((m) => m.status === 'ACTIVE').map((m) => m.memberId));
      if (memberIds.length !== ids.size || !memberIds.every((id) => ids.has(id))) {
        throw new DomainError(
          'VALIDATION_FAILED',
          'L’ordre doit contenir exactement les membres actifs de la tontine',
        );
      }
      await this.uow.run(async (tx) => {
        await tx.tontine.update({
          where: { id: t.id },
          data: { drawOrder: { memberIds } as object, version: { increment: 1 } },
        });
        for (const [i, memberId] of memberIds.entries())
          await tx.tontineMember.update({
            where: { tontineId_memberId: { tontineId: t.id, memberId } },
            data: { position: i + 1 },
          });
        await this.audit.record(
          {
            action: 'tontine.draw_order.set',
            resourceType: 'tontine',
            resourceId: t.id,
            result: 'SUCCESS',
            metadata: { memberIds },
          },
          tx,
        );
      });
      return { memberIds };
    }
    if (t.status !== 'ACTIVE' && t.status !== 'PAUSED')
      throw new DomainError('INVALID_STATE_TRANSITION', `Tontine ${t.status}`);
    // Cycles futurs uniquement : positions > cycle courant, membres non encore servis
    const current = t.currentCycleNumber ?? 1;
    const order = (t.drawOrder as unknown as DrawOrderRecord).memberIds;
    const fixed = order.slice(0, current);
    const future = order.slice(current);
    if (memberIds.length !== future.length || !memberIds.every((id) => future.includes(id))) {
      throw new DomainError(
        'VALIDATION_FAILED',
        `Seuls les ${future.length} passages futurs peuvent être réordonnés`,
        { futureMemberIds: future },
      );
    }
    const next = [...fixed, ...memberIds];
    await this.uow.run(async (tx) => {
      await tx.tontine.update({
        where: { id: t.id },
        data: { drawOrder: { memberIds: next } as object, version: { increment: 1 } },
      });
      for (const [i, memberId] of next.entries())
        await tx.tontineMember.update({
          where: { tontineId_memberId: { tontineId: t.id, memberId } },
          data: { position: i + 1 },
        });
      await this.audit.record(
        {
          action: 'tontine.draw_order.updated',
          resourceType: 'tontine',
          resourceId: t.id,
          result: 'SUCCESS',
          metadata: { memberIds: next },
        },
        tx,
      );
    });
    return { memberIds: next };
  }

  /** Bénéficiaire du cycle `n` selon le mode (appelé à l'ouverture de chaque cycle). */
  beneficiaryFor(t: Tontine, n: number): string | null {
    if (t.drawMode === 'PRIORITY_NEED') return null;
    return (t.drawOrder as DrawOrderRecord | null)?.memberIds[n - 1] ?? null;
  }

  /** A-15 — demande prioritaire motivée (mode PRIORITY_NEED). */
  async requestPriority(actor: Actor, tontineId: string, reason: string) {
    const { tontine, membership } = await this.tontines.getVisible(actor, tontineId);
    if (tontine.drawMode !== 'PRIORITY_NEED')
      throw new DomainError(
        'BUSINESS_RULE_VIOLATION',
        'Demandes prioritaires réservées au mode « besoin prioritaire »',
      );
    if (!membership || membership.status !== 'ACTIVE')
      throw new DomainError('FORBIDDEN', 'Réservé aux participants actifs');
    if (membership.receivedPayout)
      throw new DomainError('BUSINESS_RULE_VIOLATION', 'Vous avez déjà été bénéficiaire');
    if (!['READY', 'DRAFT', 'ACTIVE'].includes(tontine.status))
      throw new DomainError('INVALID_STATE_TRANSITION', `Tontine ${tontine.status}`);
    const pending = await this.prisma.priorityRequest.findFirst({
      where: { tontineId, memberId: actor.userId, status: 'PENDING' },
    });
    if (pending) throw new DomainError('CONFLICT', 'Vous avez déjà une demande en attente');
    const r = await this.prisma.priorityRequest.create({
      data: { tontineId, memberId: actor.userId, reason, createdAt: this.clock.now() },
    });
    return {
      id: r.id,
      memberId: r.memberId,
      reason: r.reason,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async priorityRequests(actor: Actor, tontineId: string) {
    const { membership } = await this.tontines.getVisible(actor, tontineId);
    const isAdmin = membership?.role === 'ADMIN' || actor.role === 'SUPER_ADMIN';
    const rows = await this.prisma.priorityRequest.findMany({
      where: { tontineId, ...(isAdmin ? {} : { memberId: actor.userId }) },
      orderBy: { createdAt: 'asc' },
    });
    const names = new Map(
      (await this.members.snapshots(rows.map((r) => r.memberId))).map((s) => [s.id, s.firstName]),
    );
    return rows.map((r) => ({
      id: r.id,
      memberId: r.memberId,
      firstName: names.get(r.memberId) ?? '—',
      reason: r.reason,
      status: r.status,
      cycleNumber: r.cycleNumber,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** A-15 — l'admin désigne le bénéficiaire d'un cycle (parmi les non-bénéficiaires). */
  async designate(actor: Actor, tontineId: string, cycleId: string, memberId: string) {
    const t = await this.tontines.getAdministered(actor, tontineId, false);
    if (t.drawMode !== 'PRIORITY_NEED')
      throw new DomainError(
        'BUSINESS_RULE_VIOLATION',
        'Désignation réservée au mode « besoin prioritaire »',
      );
    const cycle = await this.prisma.tontineCycle.findFirst({ where: { id: cycleId, tontineId } });
    if (!cycle) throw new DomainError('NOT_FOUND', 'Cycle introuvable');
    if (cycle.status !== 'IN_PROGRESS' || cycle.beneficiaryId)
      throw new DomainError(
        'INVALID_STATE_TRANSITION',
        'Bénéficiaire déjà désigné ou cycle clôturé',
      );
    const m = await this.tontines.membership(tontineId, memberId);
    if (!m || m.status !== 'ACTIVE')
      throw new DomainError('VALIDATION_FAILED', 'Le bénéficiaire doit être un participant actif');
    // US-4.6 §5 : jamais deux fois bénéficiaire dans le cycle global
    const already = await this.prisma.tontineCycle.count({
      where: { tontineId, beneficiaryId: memberId },
    });
    if (m.receivedPayout || already > 0)
      throw new DomainError('BUSINESS_RULE_VIOLATION', 'Ce membre a déjà été bénéficiaire');
    const now = this.clock.now();
    const proof = beneficiaryProof(
      t.id,
      cycle.number,
      memberId,
      'PRIORITY_NEED',
      now,
      actor.userId,
    );
    const updated = await this.uow.run(async (tx) => {
      const res = await tx.tontineCycle.updateMany({
        where: { id: cycle.id, beneficiaryId: null, status: 'IN_PROGRESS' },
        data: { beneficiaryId: memberId, beneficiaryProof: proof },
      });
      if (res.count !== 1)
        throw new DomainError('VERSION_CONFLICT', 'Le cycle a changé entre-temps');
      await tx.priorityRequest.updateMany({
        where: { tontineId, memberId, status: 'PENDING' },
        data: { status: 'SELECTED', cycleNumber: cycle.number },
      });
      await tx.tontineMember.update({
        where: { tontineId_memberId: { tontineId, memberId } },
        data: { position: cycle.number },
      });
      await this.outbox.add(tx, {
        type: 'tontine.beneficiary.designated',
        aggregateType: 'tontine',
        aggregateId: t.id,
        payload: {
          tontineId: t.id,
          cycleId: cycle.id,
          cycleNumber: cycle.number,
          beneficiaryId: memberId,
          mode: 'PRIORITY_NEED',
          proof,
        },
      });
      await this.audit.record(
        {
          action: 'tontine.beneficiary.designated',
          resourceType: 'tontine',
          resourceId: t.id,
          result: 'SUCCESS',
          metadata: { cycleNumber: cycle.number, memberId, proof },
        },
        tx,
      );
      return tx.tontineCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    });
    return {
      cycleId: updated.id,
      number: updated.number,
      beneficiaryId: updated.beneficiaryId,
      proof,
      designatedAt: now.toISOString(),
    };
  }

  // ------------------------------------------------------------------ vues
  async drawProof(actor: Actor, tontineId: string) {
    const { tontine } = await this.tontines.getVisible(actor, tontineId);
    const rec = tontine.drawOrder as DrawOrderRecord | null;
    if (!rec?.memberIds.length)
      throw new DomainError('NOT_FOUND', 'Aucun tirage pour cette tontine');
    const names = new Map(
      (await this.members.snapshots(rec.memberIds)).map((s) => [s.id, s.firstName]),
    );
    const verified =
      rec.seed && rec.proof && rec.drawnAt
        ? verifyDraw(tontine.id, rec.memberIds, {
            order: rec.memberIds,
            seedHex: rec.seed,
            proof: rec.proof,
            drawnAt: rec.drawnAt,
          })
        : null;
    return {
      drawMode: tontine.drawMode,
      algorithm: rec.algorithm ?? null,
      seed: rec.seed ?? null,
      seedHash: tontine.drawSeedHash,
      proof: rec.proof ?? null,
      drawnAt: rec.drawnAt ?? null,
      verified,
      order: rec.memberIds.map((id, i) => ({
        position: i + 1,
        memberId: id,
        firstName: names.get(id) ?? '—',
      })),
    };
  }

  async cycles(actor: Actor, tontineId: string) {
    const { tontine } = await this.tontines.getVisible(actor, tontineId);
    const rows = await this.prisma.tontineCycle.findMany({
      where: { tontineId },
      orderBy: { number: 'asc' },
      include: { contributions: { select: { status: true } } },
    });
    const names = new Map(
      (
        await this.members.snapshots(
          rows.flatMap((r) => (r.beneficiaryId ? [r.beneficiaryId] : [])),
        )
      ).map((s) => [s.id, s.firstName]),
    );
    return rows.map((c) => ({
      id: c.id,
      number: c.number,
      status: c.status,
      startDate: iso(c.startDate),
      dueDate: iso(c.dueDate),
      beneficiary: c.beneficiaryId
        ? { memberId: c.beneficiaryId, firstName: names.get(c.beneficiaryId) ?? '—' }
        : null,
      beneficiaryProof: c.beneficiaryProof,
      expected: moneyView(c.expectedMinor, tontine.currency),
      collected: moneyView(c.collectedMinor, tontine.currency),
      payout: c.payoutMinor !== null ? moneyView(c.payoutMinor, tontine.currency) : null,
      partialPayout: c.partialPayout,
      paidCount: c.contributions.filter((x) => x.status === 'PAID' || x.status === 'PAID_LATE')
        .length,
      memberCount: c.contributions.length,
      completedAt: c.completedAt?.toISOString() ?? null,
    }));
  }

  /** Détail d'un cycle : l'admin voit toutes les contributions, un membre uniquement la sienne. */
  async cycle(actor: Actor, tontineId: string, cycleId: string) {
    const { tontine, membership } = await this.tontines.getVisible(actor, tontineId);
    const isAdmin = membership?.role === 'ADMIN' || actor.role === 'SUPER_ADMIN';
    const c = await this.prisma.tontineCycle.findFirst({
      where: { id: cycleId, tontineId },
      include: { contributions: { orderBy: { createdAt: 'asc' } } },
    });
    if (!c) throw new DomainError('NOT_FOUND', 'Cycle introuvable');
    const visible = isAdmin
      ? c.contributions
      : c.contributions.filter((x) => x.memberId === actor.userId);
    const snaps = new Map(
      (
        await this.members.snapshots([
          ...visible.map((x) => x.memberId),
          ...(c.beneficiaryId ? [c.beneficiaryId] : []),
        ])
      ).map((s) => [s.id, s]),
    );
    return {
      id: c.id,
      number: c.number,
      status: c.status,
      dueDate: iso(c.dueDate),
      beneficiary: c.beneficiaryId
        ? { memberId: c.beneficiaryId, firstName: snaps.get(c.beneficiaryId)?.firstName ?? '—' }
        : null,
      expected: moneyView(c.expectedMinor, tontine.currency),
      collected: moneyView(c.collectedMinor, tontine.currency),
      remaining: moneyView(
        c.expectedMinor - c.collectedMinor > 0n ? c.expectedMinor - c.collectedMinor : 0n,
        tontine.currency,
      ),
      paidCount: c.contributions.filter((x) => x.status === 'PAID' || x.status === 'PAID_LATE')
        .length,
      memberCount: c.contributions.length,
      contributions: visible.map((x) => ({
        id: x.id,
        memberId: x.memberId,
        memberName: isAdmin
          ? `${snaps.get(x.memberId)?.firstName ?? ''} ${snaps.get(x.memberId)?.lastName ?? ''}`.trim()
          : undefined,
        status: x.status,
        amount: moneyView(x.amountMinor, tontine.currency),
        penalty: x.penaltyMinor > 0n ? moneyView(x.penaltyMinor, tontine.currency) : null,
        penaltyPaid: x.penaltyPaid,
        dueDate: iso(x.dueDate),
        graceUntil: iso(x.graceUntil),
        paidAt: x.paidAt?.toISOString() ?? null,
      })),
    };
  }
}
