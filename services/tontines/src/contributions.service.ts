import { Injectable } from '@nestjs/common';
import { moneyView } from '@tontine/contracts';
import { type Contribution, type Tontine } from '@tontine/database';
import {
  type Actor,
  AuditService,
  Clock,
  DomainError,
  KvStore,
  OutboxService,
  PrismaService,
  UnitOfWork,
} from '@tontine/platform';
import { TransactionsService } from '@tontine/transactions';
import { LedgerService } from '@tontine/wallets';
import { TontinesService } from './tontines.service';

const PAYABLE = ['PENDING', 'LATE', 'DEFAULTED'] as const;
const iso = (date: Date) => date.toISOString().slice(0, 10);

export function contributionView(
  c: Contribution,
  t: Pick<Tontine, 'id' | 'name' | 'currency'>,
  cycleNumber?: number,
) {
  const penaltyDue = c.penaltyMinor > 0n && !c.penaltyPaid ? c.penaltyMinor : 0n;
  const payable = (PAYABLE as readonly string[]).includes(c.status);
  return {
    id: c.id,
    tontineId: t.id,
    tontineName: t.name,
    cycleId: c.cycleId,
    cycleNumber,
    memberId: c.memberId,
    status: c.status,
    amount: moneyView(c.amountMinor, t.currency),
    penalty: c.penaltyMinor > 0n ? moneyView(c.penaltyMinor, t.currency) : null,
    penaltyPaid: c.penaltyPaid,
    totalDue: moneyView(payable ? c.amountMinor + penaltyDue : penaltyDue, t.currency),
    dueDate: iso(c.dueDate),
    graceUntil: iso(c.graceUntil),
    paidAt: c.paidAt?.toISOString() ?? null,
    transactionId: c.transactionId,
  };
}

/**
 * Paiement des contributions depuis le wallet (A-07, US-5.4 / US-5.5) : blocage (hold) puis
 * capture dans une transaction interne CONTRIBUTION (membre → cagnotte, pénalité → réserve, A-08).
 */
@Injectable()
export class ContributionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly transactions: TransactionsService,
    private readonly tontines: TontinesService,
    private readonly kv: KvStore,
  ) {}

  /**
   * Verrou applicatif par échéance (KV atomique, TTL 60 s) : un seul paiement à la fois pour une
   * contribution donnée ; les requêtes concurrentes reçoivent 409 puis constatent l'état PAID.
   */
  async pay(actor: Actor, tontineId: string, contributionId: string) {
    const lock = `lock:contribution:${contributionId}`;
    if ((await this.kv.incr(lock, 60)) !== 1)
      throw new DomainError('IDEMPOTENCY_IN_PROGRESS', 'Paiement de cette échéance déjà en cours');
    try {
      return await this.payLocked(actor, tontineId, contributionId);
    } finally {
      await this.kv.del(lock);
    }
  }

  private async payLocked(actor: Actor, tontineId: string, contributionId: string) {
    const { tontine, membership } = await this.tontines.getVisible(actor, tontineId);
    const c = await this.prisma.contribution.findFirst({
      where: { id: contributionId, tontineId },
    });
    // Un membre ne règle que SA contribution (isolation, US-2.5)
    if (!c || c.memberId !== actor.userId)
      throw new DomainError('NOT_FOUND', 'Contribution introuvable');
    const cycle = await this.prisma.tontineCycle.findUniqueOrThrow({ where: { id: c.cycleId } });
    if (c.status === 'PAID' || c.status === 'PAID_LATE') {
      if (c.penaltyMinor > 0n && !c.penaltyPaid)
        return this.payPenaltyOnly(actor, tontine, c, cycle.number);
      return contributionView(c, tontine, cycle.number);
    }
    if (tontine.status !== 'ACTIVE')
      throw new DomainError(
        'INVALID_STATE_TRANSITION',
        tontine.status === 'PAUSED'
          ? 'Tontine en pause : paiements suspendus'
          : `Tontine ${tontine.status}`,
      );
    if (!membership || !['ACTIVE', 'SUSPENDED'].includes(membership.status))
      throw new DomainError('FORBIDDEN', 'Adhésion inactive');
    const penaltyDue = c.penaltyMinor > 0n && !c.penaltyPaid ? c.penaltyMinor : 0n;
    const total = c.amountMinor + penaltyDue;
    const wallet = await this.prisma.wallet.findUnique({ where: { memberId: actor.userId } });
    if (!wallet) throw new DomainError('NOT_FOUND', 'Portefeuille introuvable');
    if (wallet.currency !== tontine.currency) throw new DomainError('CURRENCY_MISMATCH');
    if (!tontine.poolWalletId || !tontine.reserveWalletId)
      throw new DomainError('INTERNAL_ERROR', 'Comptes de la tontine absents');

    // 1. US-5.5 : blocage des fonds (échoue proprement si solde disponible insuffisant)
    const hold = await this.uow
      .run(
        (tx) =>
          this.ledger.createHold(tx, {
            walletId: wallet.id,
            amountMinor: total,
            context: 'TONTINE_CONTRIBUTION',
            referenceId: c.id,
            idempotencyKey: `contribution-hold:${c.id}:${c.status}`,
          }),
        { isolationLevel: 'Serializable', retries: 5 },
      )
      .catch(async (e: unknown) => {
        if (e instanceof DomainError && e.code === 'INSUFFICIENT_FUNDS') {
          await this.uow.run((tx) =>
            this.outbox.add(tx, {
              type: 'wallet.debit.failed',
              aggregateType: 'wallet',
              aggregateId: wallet.id,
              payload: {
                walletId: wallet.id,
                memberId: actor.userId,
                reason: 'INSUFFICIENT_FUNDS',
                requestedMinor: total.toString(),
              },
            }),
          );
        }
        throw e;
      });
    if (hold.status === 'CAPTURED')
      return contributionView(
        await this.prisma.contribution.findUniqueOrThrow({ where: { id: c.id } }),
        tontine,
        cycle.number,
      );

    // 2. Transaction interne (conformité, SERIALIZABLE, capture du hold) — US-5.4 / US-6.x
    let txId: string;
    try {
      const t = await this.transactions.execute({
        idempotencyKey: `contribution:${c.id}:${c.status}`,
        type: 'CONTRIBUTION',
        amountMinor: total,
        currency: tontine.currency,
        initiatorId: actor.userId,
        beneficiaryId: null,
        sourceWalletId: wallet.id,
        destinationWalletId: tontine.poolWalletId,
        captureHoldId: hold.id,
        contextType: 'TONTINE',
        contextId: tontine.id,
        description: `Contribution cycle ${cycle.number} — ${tontine.name}`,
        metadata: {
          contributionId: c.id,
          cycleNumber: cycle.number,
          penaltyMinor: penaltyDue.toString(),
        },
        lines: [
          {
            walletId: wallet.id,
            direction: 'DEBIT',
            amountMinor: total,
            context: 'TONTINE_CONTRIBUTION',
            contextRef: tontine.id,
            description: `Contribution cycle ${cycle.number} — ${tontine.name}`,
          },
          {
            walletId: tontine.poolWalletId,
            direction: 'CREDIT',
            amountMinor: c.amountMinor,
            context: 'TONTINE_CONTRIBUTION',
            contextRef: c.id,
          },
          ...(penaltyDue > 0n
            ? [
                {
                  walletId: tontine.reserveWalletId,
                  direction: 'CREDIT' as const,
                  amountMinor: penaltyDue,
                  context: 'PENALTY' as const,
                  contextRef: c.id,
                },
              ]
            : []),
        ],
        compliance: { operationType: 'TONTINE_CONTRIBUTION', memberId: actor.userId },
      });
      txId = t.id;
    } catch (e) {
      await this.uow.run((tx) => this.ledger.releaseHold(tx, hold.id), {
        isolationLevel: 'Serializable',
        retries: 5,
      });
      throw e;
    }

    // 3. Mise à jour de l'échéance et du cycle
    const now = this.clock.now();
    const status = c.status === 'PENDING' ? 'PAID' : 'PAID_LATE';
    const updated = await this.uow.run(async (tx) => {
      const res = await tx.contribution.updateMany({
        where: { id: c.id, status: { in: [...PAYABLE] } },
        data: {
          status,
          paidAt: now,
          transactionId: txId,
          ...(penaltyDue > 0n ? { penaltyPaid: true, penaltyTxId: txId } : {}),
        },
      });
      if (res.count === 1) {
        await tx.tontineCycle.update({
          where: { id: cycle.id },
          data: { collectedMinor: { increment: c.amountMinor } },
        });
        // A-09 : un paiement à l'heure remet à zéro le compteur de défauts consécutifs
        if (status === 'PAID')
          await tx.tontineMember.update({
            where: { tontineId_memberId: { tontineId, memberId: actor.userId } },
            data: { consecutiveDefaults: 0 },
          });
        await this.outbox.add(tx, {
          type: 'tontine.contribution.received',
          aggregateType: 'tontine',
          aggregateId: tontine.id,
          payload: {
            tontineId: tontine.id,
            cycleId: cycle.id,
            contributionId: c.id,
            memberId: actor.userId,
            amountMinor: c.amountMinor.toString(),
            transactionId: txId,
          },
        });
      }
      return tx.contribution.findUniqueOrThrow({ where: { id: c.id } });
    });
    return contributionView(updated, tontine, cycle.number);
  }

  /** Pénalité restée due après un paiement tardif sans pénalité (cas limite). */
  private async payPenaltyOnly(
    actor: Actor,
    tontine: Tontine,
    c: Contribution,
    cycleNumber: number,
  ) {
    const wallet = await this.prisma.wallet.findUniqueOrThrow({
      where: { memberId: actor.userId },
    });
    const t = await this.transactions.execute({
      idempotencyKey: `penalty:${c.id}`,
      type: 'PENALTY',
      amountMinor: c.penaltyMinor,
      currency: tontine.currency,
      initiatorId: actor.userId,
      beneficiaryId: null,
      sourceWalletId: wallet.id,
      destinationWalletId: tontine.reserveWalletId,
      contextType: 'TONTINE',
      contextId: tontine.id,
      description: `Pénalité de retard — ${tontine.name}`,
      lines: [
        {
          walletId: wallet.id,
          direction: 'DEBIT',
          amountMinor: c.penaltyMinor,
          context: 'PENALTY',
          contextRef: tontine.id,
          description: `Pénalité de retard — ${tontine.name}`,
        },
        {
          walletId: tontine.reserveWalletId!,
          direction: 'CREDIT',
          amountMinor: c.penaltyMinor,
          context: 'PENALTY',
          contextRef: c.id,
        },
      ],
    });
    const updated = await this.prisma.contribution.update({
      where: { id: c.id },
      data: { penaltyPaid: true, penaltyTxId: t.id },
    });
    return contributionView(updated, tontine, cycleNumber);
  }

  /** Droit d'entrée (US-4.1 §2) : prérequis au démarrage, versé sur la réserve de la tontine. */
  async payEntryFee(actor: Actor, tontineId: string) {
    const { tontine, membership } = await this.tontines.getVisible(actor, tontineId);
    if (!membership || membership.status !== 'ACTIVE')
      throw new DomainError('FORBIDDEN', 'Réservé aux participants actifs');
    if (tontine.entryFeeMinor === 0n)
      throw new DomainError('BUSINESS_RULE_VIOLATION', 'Cette tontine n’a pas de droit d’entrée');
    if (membership.entryFeePaid)
      return { entryFeePaid: true, transactionId: membership.entryFeeTxId };
    if (!['DRAFT', 'READY'].includes(tontine.status))
      throw new DomainError(
        'INVALID_STATE_TRANSITION',
        'Droit d’entrée payable avant le démarrage uniquement',
      );
    const wallet = await this.prisma.wallet.findUnique({ where: { memberId: actor.userId } });
    if (!wallet || wallet.currency !== tontine.currency) throw new DomainError('CURRENCY_MISMATCH');
    const t = await this.transactions.execute({
      idempotencyKey: `entry-fee:${tontine.id}:${actor.userId}`,
      type: 'ENTRY_FEE',
      amountMinor: tontine.entryFeeMinor,
      currency: tontine.currency,
      initiatorId: actor.userId,
      beneficiaryId: null,
      sourceWalletId: wallet.id,
      destinationWalletId: tontine.reserveWalletId,
      contextType: 'TONTINE',
      contextId: tontine.id,
      description: `Droit d’entrée — ${tontine.name}`,
      lines: [
        {
          walletId: wallet.id,
          direction: 'DEBIT',
          amountMinor: tontine.entryFeeMinor,
          context: 'ENTRY_FEE',
          contextRef: tontine.id,
          description: `Droit d’entrée — ${tontine.name}`,
        },
        {
          walletId: tontine.reserveWalletId!,
          direction: 'CREDIT',
          amountMinor: tontine.entryFeeMinor,
          context: 'ENTRY_FEE',
          contextRef: actor.userId,
        },
      ],
      compliance: { operationType: 'TONTINE_CONTRIBUTION', memberId: actor.userId },
    });
    await this.prisma.tontineMember.update({
      where: { tontineId_memberId: { tontineId, memberId: actor.userId } },
      data: { entryFeePaid: true, entryFeeTxId: t.id },
    });
    await this.audit.record({
      action: 'tontine.entry_fee.paid',
      resourceType: 'tontine',
      resourceId: tontine.id,
      result: 'SUCCESS',
      metadata: { transactionId: t.id },
    });
    return { entryFeePaid: true, transactionId: t.id };
  }

  /** Mes échéances (toutes tontines) — tableau de bord membre. */
  async mine(actor: Actor, status?: string) {
    const rows = await this.prisma.contribution.findMany({
      where: {
        memberId: actor.userId,
        ...(status ? { status: status as Contribution['status'] } : {}),
      },
      include: {
        cycle: {
          select: { number: true, tontine: { select: { id: true, name: true, currency: true } } },
        },
      },
      orderBy: [{ dueDate: 'asc' }],
      take: 200,
    });
    return rows.map((r) => contributionView(r, r.cycle.tontine, r.cycle.number));
  }
}
