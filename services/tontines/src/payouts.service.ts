import { Inject, Injectable, Logger } from '@nestjs/common';
import { applyPercentBps } from '@tontine/contracts';
import { type Tontine, type TontineCycle } from '@tontine/database';
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
} from '@tontine/platform';
import { TransactionsService } from '@tontine/transactions';
import { localDate } from './domain/calendar';
import { CyclesService } from './cycles.service';
import { TontinesService } from './tontines.service';

const PAID = ['PAID', 'PAID_LATE'] as const;
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
/** US-4.9 §6 : archivage consultable 5 ans minimum (A-18). */
export const ARCHIVE_YEARS = 5;

/**
 * Retards et pénalités (US-4.5), paiement du bénéficiaire (US-4.7), passage au cycle suivant
 * (US-4.8) et clôture (US-4.9).
 */
@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly transactions: TransactionsService,
    private readonly cycles: CyclesService,
    private readonly tontines: TontinesService,
    @Inject(MEMBER_QUERY) private readonly members: MemberQueryPort,
  ) {}

  // ------------------------------------------------------------------ US-4.5 retards
  /**
   * Tâche (horaire, pour couvrir tous les fuseaux) : PENDING dont l'échéance + grâce est dépassée
   * → LATE + pénalité (contribution × % / 100) ; LATE au-delà de `defaultAfterDays` → DEFAULTED (A-09).
   */
  @ScheduledJob({
    name: 'tontines.late-detection',
    cron: '0 15 * * * *',
    description: 'Détection des retards, pénalités, défauts et suspensions (US-4.5)',
  })
  async detectLate(): Promise<{ late: number; defaulted: number; suspended: number }> {
    const tontines = await this.prisma.tontine.findMany({ where: { status: 'ACTIVE' } });
    let late = 0;
    let defaulted = 0;
    let suspended = 0;
    for (const t of tontines) {
      const today = d(localDate(t.timezone, this.clock.now()));
      const overdue = await this.prisma.contribution.findMany({
        where: { tontineId: t.id, status: 'PENDING', graceUntil: { lt: today } },
      });
      for (const c of overdue) {
        const r = await this.markLate(t, c.id);
        if (r.late) late++;
        if (r.suspended) suspended++;
      }
      const toDefault = await this.prisma.contribution.findMany({
        where: { tontineId: t.id, status: 'LATE', defaultAt: { lt: today } },
      });
      for (const c of toDefault) {
        await this.uow.run(async (tx) => {
          const res = await tx.contribution.updateMany({
            where: { id: c.id, status: 'LATE' },
            data: { status: 'DEFAULTED' },
          });
          if (res.count !== 1) return;
          defaulted++;
          await this.outbox.add(tx, {
            type: 'tontine.contribution.defaulted',
            aggregateType: 'tontine',
            aggregateId: t.id,
            payload: {
              tontineId: t.id,
              cycleId: c.cycleId,
              contributionId: c.id,
              memberId: c.memberId,
            },
          });
        });
      }
    }
    return { late, defaulted, suspended };
  }

  private async markLate(
    t: Tontine,
    contributionId: string,
  ): Promise<{ late: boolean; suspended: boolean }> {
    return this.uow.run(async (tx) => {
      const c = await tx.contribution.findUniqueOrThrow({ where: { id: contributionId } });
      const penalty = applyPercentBps(c.amountMinor, t.lateFeeBps);
      const res = await tx.contribution.updateMany({
        where: { id: c.id, status: 'PENDING' },
        data: { status: 'LATE', penaltyMinor: penalty },
      });
      if (res.count !== 1) return { late: false, suspended: false };
      await this.outbox.add(tx, {
        type: 'tontine.contribution.late',
        aggregateType: 'tontine',
        aggregateId: t.id,
        payload: {
          tontineId: t.id,
          cycleId: c.cycleId,
          contributionId: c.id,
          memberId: c.memberId,
          penaltyMinor: penalty.toString(),
          currency: t.currency,
        },
      });
      // R-TON-05 : suspension après N défauts consécutifs (configurable)
      const m = await tx.tontineMember.update({
        where: { tontineId_memberId: { tontineId: t.id, memberId: c.memberId } },
        data: { consecutiveDefaults: { increment: 1 } },
      });
      if (m.consecutiveDefaults >= t.suspendAfter && m.status === 'ACTIVE') {
        await tx.tontineMember.update({ where: { id: m.id }, data: { status: 'SUSPENDED' } });
        await this.outbox.add(tx, {
          type: 'tontine.member.suspended',
          aggregateType: 'tontine',
          aggregateId: t.id,
          payload: {
            tontineId: t.id,
            memberId: c.memberId,
            consecutiveDefaults: m.consecutiveDefaults,
          },
        });
        return { late: true, suspended: true };
      }
      return { late: true, suspended: false };
    });
  }

  // ------------------------------------------------------------------ US-4.7 paiement du bénéficiaire
  /** Déclenché à chaque contribution reçue ; paie le pot dès que le cycle est complet. */
  async onContributionReceived(
    cycleId: string,
    contributionId: string,
    amountMinor: bigint,
  ): Promise<void> {
    const cycle = await this.prisma.tontineCycle.findUniqueOrThrow({ where: { id: cycleId } });
    if (cycle.status === 'COMPLETED') {
      if (cycle.partialPayout) await this.topUp(cycle, contributionId, amountMinor);
      return;
    }
    await this.payout(cycleId, { mode: 'AUTO' });
  }

  /**
   * Paiement du pot : total = Σ contributions reçues − collation (A-39 : collation → réserve).
   * AUTO : uniquement si toutes les contributions sont PAID / PAID_LATE. PARTIAL : paiement
   * partiel (politique PARTIAL_PAYOUT à l'échéance, ou décision explicite de l'admin).
   */
  async payout(
    cycleId: string,
    opts: { mode: 'AUTO' | 'PARTIAL'; actorId?: string; reason?: string },
  ): Promise<{ paid: boolean; reason?: string }> {
    const cycle = await this.prisma.tontineCycle.findUniqueOrThrow({
      where: { id: cycleId },
      include: { contributions: true, tontine: true },
    });
    const t = cycle.tontine;
    if (cycle.status === 'COMPLETED') return { paid: false, reason: 'Cycle déjà payé' };
    if (t.status !== 'ACTIVE') return { paid: false, reason: `Tontine ${t.status}` };
    if (!cycle.beneficiaryId) return { paid: false, reason: 'Bénéficiaire non désigné' };
    const complete = cycle.contributions.every((c) =>
      (PAID as readonly string[]).includes(c.status),
    );
    if (!complete && opts.mode === 'AUTO')
      return { paid: false, reason: 'Contributions incomplètes' };
    const collected = cycle.contributions
      .filter((c) => (PAID as readonly string[]).includes(c.status))
      .reduce((s, c) => s + c.amountMinor, 0n);
    if (collected <= 0n) return { paid: false, reason: 'Aucune contribution reçue' };
    const collation = t.collationMinor < collected ? t.collationMinor : 0n;
    const net = collected - collation;
    const beneficiaryWallet = await this.prisma.wallet.findUnique({
      where: { memberId: cycle.beneficiaryId },
    });
    if (!beneficiaryWallet || !t.poolWalletId || !t.reserveWalletId)
      throw new DomainError('INTERNAL_ERROR', 'Portefeuilles introuvables');

    let txId: string;
    try {
      const tr = await this.transactions.execute({
        idempotencyKey: `payout:${cycle.id}`,
        type: 'PAYOUT',
        amountMinor: collected,
        currency: t.currency,
        initiatorId: opts.actorId ?? null,
        beneficiaryId: cycle.beneficiaryId,
        sourceWalletId: t.poolWalletId,
        destinationWalletId: beneficiaryWallet.id,
        contextType: 'TONTINE',
        contextId: t.id,
        description: `Pot du cycle ${cycle.number} — ${t.name}`,
        metadata: {
          cycleId: cycle.id,
          cycleNumber: cycle.number,
          collationMinor: collation.toString(),
          partial: !complete,
        },
        lines: [
          {
            walletId: t.poolWalletId,
            direction: 'DEBIT',
            amountMinor: collected,
            context: 'TONTINE_PAYOUT',
            contextRef: cycle.id,
          },
          {
            walletId: beneficiaryWallet.id,
            direction: 'CREDIT',
            amountMinor: net,
            context: 'TONTINE_PAYOUT',
            contextRef: t.id,
            description: `Pot du cycle ${cycle.number} — ${t.name}`,
          },
          ...(collation > 0n
            ? [
                {
                  walletId: t.reserveWalletId,
                  direction: 'CREDIT' as const,
                  amountMinor: collation,
                  context: 'COLLATION' as const,
                  contextRef: cycle.id,
                },
              ]
            : []),
        ],
        compliance: {
          operationType: 'TONTINE_PAYOUT',
          memberId: cycle.beneficiaryId,
          creditMemberId: cycle.beneficiaryId,
        },
      });
      txId = tr.id;
    } catch (e) {
      // Paiement bloqué (conformité, wallet) : le cycle reste en attente de paiement, l'admin est alerté
      const reason = e instanceof DomainError ? e.message : 'Erreur technique';
      this.logger.warn(`Paiement du cycle ${cycle.id} bloqué : ${reason}`);
      await this.prisma.tontineCycle.updateMany({
        where: { id: cycle.id, status: 'IN_PROGRESS' },
        data: { status: 'PAYOUT_PENDING' },
      });
      await this.audit.record({
        action: 'tontine.payout.blocked',
        resourceType: 'tontine',
        resourceId: t.id,
        result: 'FAILURE',
        metadata: { cycleId: cycle.id, reason },
      });
      return { paid: false, reason };
    }

    const next = await this.uow.run(async (tx) => {
      const res = await tx.tontineCycle.updateMany({
        where: { id: cycle.id, status: { in: ['IN_PROGRESS', 'PAYOUT_PENDING'] } },
        data: {
          status: 'COMPLETED',
          payoutMinor: net,
          payoutTxId: txId,
          partialPayout: !complete,
          completedAt: this.clock.now(),
        },
      });
      if (res.count !== 1) return null;
      await tx.tontineMember.update({
        where: { tontineId_memberId: { tontineId: t.id, memberId: cycle.beneficiaryId! } },
        data: { receivedPayout: true },
      });
      await this.outbox.addMany(tx, [
        {
          type: 'tontine.payout.initiated',
          aggregateType: 'tontine',
          aggregateId: t.id,
          payload: {
            tontineId: t.id,
            cycleId: cycle.id,
            beneficiaryId: cycle.beneficiaryId!,
            totalMinor: net.toString(),
            currency: t.currency,
            partial: !complete,
          },
        },
        {
          type: 'tontine.cycle.completed',
          aggregateType: 'tontine',
          aggregateId: t.id,
          payload: {
            tontineId: t.id,
            cycleId: cycle.id,
            cycleNumber: cycle.number,
            beneficiaryId: cycle.beneficiaryId!,
            totalMinor: net.toString(),
            currency: t.currency,
          },
        },
      ]);
      if (!complete) {
        await this.audit.record(
          {
            action: 'tontine.payout.partial',
            resourceType: 'tontine',
            resourceId: t.id,
            result: 'SUCCESS',
            actorId: opts.actorId ?? null,
            metadata: {
              cycleId: cycle.id,
              reason: opts.reason ?? 'Politique PARTIAL_PAYOUT',
              collected: collected.toString(),
              expected: cycle.expectedMinor.toString(),
            },
          },
          tx,
        );
      }
      // US-4.8 : cycle suivant ou clôture
      const total = t.totalCycles ?? 0;
      if (cycle.number >= total) return 'CLOSE' as const;
      const fresh = await tx.tontine.update({
        where: { id: t.id },
        data: { currentCycleNumber: cycle.number + 1, version: { increment: 1 } },
      });
      const participants = await tx.tontineMember.findMany({
        where: { tontineId: t.id, status: { in: ['ACTIVE', 'SUSPENDED'] } },
        orderBy: { joinedAt: 'asc' },
      });
      await this.cycles.openCycle(
        tx,
        fresh,
        cycle.number + 1,
        this.cycles.beneficiaryFor(fresh, cycle.number + 1),
        participants.map((p) => p.memberId),
      );
      return 'NEXT' as const;
    });
    if (next === 'CLOSE') await this.tryClose(t.id);
    return { paid: next !== null };
  }

  /** Arriérés payés après un paiement partiel : reversés au bénéficiaire du cycle concerné. */
  private async topUp(
    cycle: TontineCycle,
    contributionId: string,
    amountMinor: bigint,
  ): Promise<void> {
    const t = await this.prisma.tontine.findUniqueOrThrow({ where: { id: cycle.tontineId } });
    const w = await this.prisma.wallet.findUnique({ where: { memberId: cycle.beneficiaryId! } });
    if (!w || !t.poolWalletId) return;
    await this.transactions.execute({
      idempotencyKey: `payout-topup:${contributionId}`,
      type: 'PAYOUT',
      amountMinor,
      currency: t.currency,
      initiatorId: null,
      beneficiaryId: cycle.beneficiaryId,
      sourceWalletId: t.poolWalletId,
      destinationWalletId: w.id,
      contextType: 'TONTINE',
      contextId: t.id,
      description: `Complément du pot du cycle ${cycle.number} — ${t.name}`,
      lines: [
        {
          walletId: t.poolWalletId,
          direction: 'DEBIT',
          amountMinor,
          context: 'TONTINE_PAYOUT',
          contextRef: cycle.id,
        },
        {
          walletId: w.id,
          direction: 'CREDIT',
          amountMinor,
          context: 'TONTINE_PAYOUT',
          contextRef: t.id,
          description: `Complément du pot du cycle ${cycle.number} — ${t.name}`,
        },
      ],
    });
    await this.prisma.tontineCycle.update({
      where: { id: cycle.id },
      data: { payoutMinor: { increment: amountMinor } },
    });
    await this.tryClose(t.id);
  }

  /** A-10 — paiement partiel explicite par l'admin (journalisé). */
  async forcePayout(actor: Actor, tontineId: string, cycleId: string, reason: string) {
    await this.tontines.getAdministered(actor, tontineId, false);
    const cycle = await this.prisma.tontineCycle.findFirst({ where: { id: cycleId, tontineId } });
    if (!cycle) throw new DomainError('NOT_FOUND', 'Cycle introuvable');
    const r = await this.payout(cycleId, { mode: 'PARTIAL', actorId: actor.userId, reason });
    if (!r.paid) throw new DomainError('PAYOUT_NOT_READY', r.reason ?? 'Paiement impossible');
    return { paid: true };
  }

  /** Échéance dépassée : PARTIAL_PAYOUT → paiement partiel ; POSTPONE → report (A-10). */
  @ScheduledJob({
    name: 'tontines.payouts',
    cron: '0 20 * * * *',
    description: 'Cycles échus : paiement partiel ou report selon la politique (US-4.7 §7)',
  })
  async handleOverdueCycles(): Promise<{ partial: number; postponed: number }> {
    const cycles = await this.prisma.tontineCycle.findMany({
      where: { status: { in: ['IN_PROGRESS', 'PAYOUT_PENDING'] }, tontine: { status: 'ACTIVE' } },
      include: { tontine: true },
    });
    let partial = 0;
    let postponed = 0;
    for (const c of cycles) {
      const today = d(localDate(c.tontine.timezone, this.clock.now()));
      const deadline = new Date(c.dueDate.getTime() + c.tontine.graceDays * 86_400_000);
      if (deadline >= today) continue;
      if (c.tontine.incompletePolicy === 'PARTIAL_PAYOUT') {
        if (
          (
            await this.payout(c.id, {
              mode: 'PARTIAL',
              reason: 'Politique PARTIAL_PAYOUT à l’échéance',
            })
          ).paid
        )
          partial++;
      } else {
        const days = Math.floor((today.getTime() - deadline.getTime()) / 86_400_000);
        if (days !== c.postponedCount)
          await this.prisma.tontineCycle.update({
            where: { id: c.id },
            data: { postponedCount: days },
          });
        postponed++;
      }
    }
    return { partial, postponed };
  }

  // ------------------------------------------------------------------ US-4.9 clôture
  async closureBlockers(tontineId: string): Promise<string[]> {
    const t = await this.prisma.tontine.findUniqueOrThrow({ where: { id: tontineId } });
    const blockers: string[] = [];
    const openCycles = await this.prisma.tontineCycle.count({
      where: { tontineId, status: { not: 'COMPLETED' } },
    });
    const done = await this.prisma.tontineCycle.count({
      where: { tontineId, status: 'COMPLETED' },
    });
    if (openCycles > 0 || done < (t.totalCycles ?? 0))
      blockers.push('Tous les cycles ne sont pas terminés');
    const unpaid = await this.prisma.contribution.count({
      where: { tontineId, status: { in: ['PENDING', 'LATE', 'DEFAULTED'] } },
    });
    if (unpaid > 0) blockers.push(`${unpaid} contribution(s) non payée(s)`);
    const penalties = await this.prisma.contribution.count({
      where: { tontineId, penaltyMinor: { gt: 0n }, penaltyPaid: false },
    });
    if (penalties > 0) blockers.push(`${penalties} pénalité(s) impayée(s)`);
    return blockers;
  }

  async tryClose(tontineId: string): Promise<{ closed: boolean; blockers: string[] }> {
    const t = await this.prisma.tontine.findUniqueOrThrow({ where: { id: tontineId } });
    if (t.status !== 'ACTIVE') return { closed: false, blockers: [`Tontine ${t.status}`] };
    const blockers = await this.closureBlockers(tontineId);
    if ((t.currentCycleNumber ?? 0) < (t.totalCycles ?? 0) && blockers.length === 0)
      blockers.push('Tous les cycles ne sont pas terminés');
    if (blockers.length) {
      if ((t.currentCycleNumber ?? 0) >= (t.totalCycles ?? 0)) {
        await this.uow.run((tx) =>
          this.outbox.add(tx, {
            type: 'tontine.closure.blocked',
            aggregateType: 'tontine',
            aggregateId: t.id,
            payload: { tontineId: t.id, blockers },
          }),
        );
      }
      return { closed: false, blockers };
    }
    const total = await this.prisma.tontineCycle.aggregate({
      where: { tontineId },
      _sum: { payoutMinor: true },
    });
    const now = this.clock.now();
    await this.uow.run(async (tx) => {
      const res = await tx.tontine.updateMany({
        where: { id: t.id, status: 'ACTIVE' },
        data: {
          status: 'COMPLETED',
          completedAt: now,
          archivedUntil: new Date(
            Date.UTC(now.getUTCFullYear() + ARCHIVE_YEARS, now.getUTCMonth(), now.getUTCDate()),
          ),
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) return;
      await this.outbox.add(tx, {
        type: 'tontine.closed',
        aggregateType: 'tontine',
        aggregateId: t.id,
        payload: {
          tontineId: t.id,
          totalCycles: t.totalCycles ?? 0,
          totalMinor: (total._sum.payoutMinor ?? 0n).toString(),
          currency: t.currency,
        },
      });
      await this.audit.record(
        {
          action: 'tontine.closed',
          resourceType: 'tontine',
          resourceId: t.id,
          result: 'SUCCESS',
          metadata: { totalMinor: (total._sum.payoutMinor ?? 0n).toString() },
        },
        tx,
      );
    });
    return { closed: true, blockers: [] };
  }

  /** Relance quotidienne des clôtures bloquées (arriérés réglés entre-temps). */
  @ScheduledJob({
    name: 'tontines.closure',
    cron: '0 30 2 * * *',
    description: 'Clôture des tontines dont tous les cycles sont terminés (US-4.9)',
  })
  async closeDue(): Promise<{ closed: number }> {
    const candidates = await this.prisma.tontine.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, currentCycleNumber: true, totalCycles: true },
    });
    let closed = 0;
    for (const c of candidates.filter(
      (x) => (x.currentCycleNumber ?? 0) >= (x.totalCycles ?? Infinity),
    )) {
      if ((await this.tryClose(c.id)).closed) closed++;
    }
    return { closed };
  }

  // ------------------------------------------------------------------ pause / reprise (super-admin)
  async setPaused(actor: Actor, tontineId: string, paused: boolean, reason: string) {
    const t = await this.prisma.tontine.findUnique({ where: { id: tontineId } });
    if (!t) throw new DomainError('NOT_FOUND', 'Tontine introuvable');
    const from = paused ? 'ACTIVE' : 'PAUSED';
    if (t.status !== from) throw new DomainError('INVALID_STATE_TRANSITION', `Tontine ${t.status}`);
    await this.uow.run(async (tx) => {
      const res = await tx.tontine.updateMany({
        where: { id: t.id, status: from },
        data: {
          status: paused ? 'PAUSED' : 'ACTIVE',
          pausedReason: paused ? reason : null,
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw new DomainError('VERSION_CONFLICT');
      await this.outbox.add(tx, {
        type: paused ? 'tontine.paused' : 'tontine.resumed',
        aggregateType: 'tontine',
        aggregateId: t.id,
        payload: { tontineId: t.id, reason },
      });
      await this.audit.record(
        {
          action: paused ? 'tontine.paused' : 'tontine.resumed',
          resourceType: 'tontine',
          resourceId: t.id,
          result: 'SUCCESS',
          metadata: { reason, by: actor.userId },
        },
        tx,
      );
    });
    return { id: t.id, status: paused ? 'PAUSED' : 'ACTIVE', reason };
  }

  /** Pour les vues : noms des bénéficiaires. */
  async names(ids: string[]): Promise<Map<string, string>> {
    return new Map(
      (await this.members.snapshots(ids)).map((s) => [s.id, `${s.firstName} ${s.lastName}`]),
    );
  }
}
