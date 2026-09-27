import { Injectable } from '@nestjs/common';
import { type WalletHold } from '@tontine/database';
import { type EventEnvelope } from '@tontine/events';
import { DomainError, OutboxService, UnitOfWork } from '@tontine/platform';
import { LedgerService } from '@tontine/wallets';
import { TransactionsService } from '../transactions.service';
import { SagaOrchestrator } from './saga-orchestrator';

type Requested = EventEnvelope<'tontine.contribution.payment.requested'>['payload'];

/**
 * Saga de contribution (docs/sagas.md §4, A-53) :
 * `tontine.contribution.payment.requested` → HOLD (blocage des fonds du membre) →
 * COMPLIANCE_AND_CAPTURE (conformité, capture : membre → cagnotte, pénalité → réserve) →
 * `transaction.saga.completed` → Tontine Service marque l'échéance PAID / PAID_LATE.
 *
 * Compensation (docs/sagas.md §6) : échec après le blocage → libération du hold, saga
 * COMPENSATED ; échec du blocage (fonds insuffisants…) → saga FAILED sans effet.
 */
@Injectable()
export class ContributionSaga {
  constructor(
    private readonly sagas: SagaOrchestrator,
    private readonly transactions: TransactionsService,
    private readonly ledger: LedgerService,
    private readonly uow: UnitOfWork,
    private readonly outbox: OutboxService,
  ) {}

  async run(p: Requested): Promise<void> {
    const amount = BigInt(p.amountMinor);
    const penalty = BigInt(p.penaltyMinor);
    const total = amount + penalty;
    let saga = await this.sagas.begin(
      'CONTRIBUTION',
      `contribution:${p.requestId}`,
      `${p.contributionId}:${p.requestId}`,
      { ...p },
    );
    if (saga.status !== 'STARTED') return;

    // 1. Blocage des fonds (idempotent par demande)
    saga = await this.sagas.advance(saga, 'HOLD');
    let hold: WalletHold;
    try {
      hold = await this.uow.run(
        (tx) =>
          this.ledger.createHold(tx, {
            walletId: p.memberWalletId,
            amountMinor: total,
            context: 'TONTINE_CONTRIBUTION',
            referenceId: p.contributionId,
            idempotencyKey: `contribution-hold:${p.requestId}`,
          }),
        { isolationLevel: 'Serializable', retries: 5 },
      );
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
      await this.uow.run(async (tx) => {
        if (e.code === 'INSUFFICIENT_FUNDS')
          await this.outbox.add(tx, {
            type: 'wallet.debit.failed',
            aggregateType: 'wallet',
            aggregateId: p.memberWalletId,
            payload: {
              walletId: p.memberWalletId,
              memberId: p.memberId,
              reason: 'INSUFFICIENT_FUNDS',
              requestedMinor: total.toString(),
            },
          });
        await this.sagas.fail(
          saga,
          { code: e.code, reason: e.message, compensated: false, requiresReconciliation: false },
          tx,
        );
      });
      return;
    }

    // 2. Conformité et capture du hold (transaction SERIALIZABLE)
    saga = await this.sagas.advance(saga, 'COMPLIANCE_AND_CAPTURE', { holdId: hold.id });
    let transactionId: string;
    try {
      const t = await this.transactions.execute({
        idempotencyKey: `contribution:${p.requestId}`,
        type: 'CONTRIBUTION',
        amountMinor: total,
        currency: p.currency,
        initiatorId: p.memberId,
        beneficiaryId: null,
        sourceWalletId: p.memberWalletId,
        destinationWalletId: p.poolWalletId,
        captureHoldId: hold.id,
        contextType: 'TONTINE',
        contextId: p.tontineId,
        description: p.description,
        metadata: {
          contributionId: p.contributionId,
          cycleNumber: p.cycleNumber,
          penaltyMinor: p.penaltyMinor,
          sagaId: saga.id,
        },
        lines: [
          {
            walletId: p.memberWalletId,
            direction: 'DEBIT',
            amountMinor: total,
            context: 'TONTINE_CONTRIBUTION',
            contextRef: p.tontineId,
            description: p.description,
          },
          {
            walletId: p.poolWalletId,
            direction: 'CREDIT',
            amountMinor: amount,
            context: 'TONTINE_CONTRIBUTION',
            contextRef: p.contributionId,
          },
          ...(penalty > 0n
            ? [
                {
                  walletId: p.reserveWalletId,
                  direction: 'CREDIT' as const,
                  amountMinor: penalty,
                  context: 'PENALTY' as const,
                  contextRef: p.contributionId,
                },
              ]
            : []),
        ],
        compliance: { operationType: 'TONTINE_CONTRIBUTION', memberId: p.memberId },
      });
      transactionId = t.id;
    } catch (e) {
      if (!(e instanceof DomainError) || e.code === 'IDEMPOTENCY_IN_PROGRESS') throw e;
      // Compensation : libération du hold et fin de saga dans la même transaction SQL
      await this.uow.run(
        async (tx) => {
          await this.ledger.releaseHold(tx, hold.id);
          await this.sagas.fail(
            saga,
            { code: e.code, reason: e.message, compensated: true, requiresReconciliation: false },
            tx,
          );
        },
        { isolationLevel: 'Serializable', retries: 5 },
      );
      return;
    }
    await this.sagas.complete(saga, transactionId);
  }
}
