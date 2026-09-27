import { Injectable } from '@nestjs/common';
import { type EventEnvelope } from '@tontine/events';
import { DomainError } from '@tontine/platform';
import { type PostingLine } from '@tontine/wallets';
import { type ExecuteInput, TransactionsService } from '../transactions.service';
import { SagaOrchestrator } from './saga-orchestrator';

type PayoutRequested = EventEnvelope<'tontine.payout.requested'>['payload'];
type TopUpRequested = EventEnvelope<'tontine.payout.topup.requested'>['payload'];

/**
 * Sagas de paiement du bénéficiaire (docs/sagas.md §5, A-53) :
 * `tontine.payout.requested` → conformité → débit cagnotte / crédit bénéficiaire (+ collation
 * vers la réserve) en une transaction SQL → `transaction.saga.completed` → Tontine Service
 * clôt le cycle. Échec métier : aucune écriture (rollback) → `transaction.saga.failed`, le
 * cycle revient en attente de paiement.
 */
@Injectable()
export class TontinePayoutSaga {
  constructor(
    private readonly sagas: SagaOrchestrator,
    private readonly transactions: TransactionsService,
  ) {}

  async payout(p: PayoutRequested): Promise<void> {
    const collected = BigInt(p.collectedMinor);
    const net = BigInt(p.netMinor);
    const collation = BigInt(p.collationMinor);
    const lines: PostingLine[] = [
      {
        walletId: p.poolWalletId,
        direction: 'DEBIT',
        amountMinor: collected,
        context: 'TONTINE_PAYOUT',
        contextRef: p.cycleId,
      },
      {
        walletId: p.beneficiaryWalletId,
        direction: 'CREDIT',
        amountMinor: net,
        context: 'TONTINE_PAYOUT',
        contextRef: p.tontineId,
        description: p.description,
      },
      ...(collation > 0n
        ? [
            {
              walletId: p.reserveWalletId,
              direction: 'CREDIT' as const,
              amountMinor: collation,
              context: 'COLLATION' as const,
              contextRef: p.cycleId,
            },
          ]
        : []),
    ];
    const key = `payout:${p.cycleId}:${p.requestId}`;
    await this.execute('TONTINE_PAYOUT', key, p.cycleId, p, {
      idempotencyKey: key,
      type: 'PAYOUT',
      amountMinor: collected,
      currency: p.currency,
      initiatorId: p.initiatorId,
      beneficiaryId: p.beneficiaryId,
      sourceWalletId: p.poolWalletId,
      destinationWalletId: p.beneficiaryWalletId,
      contextType: 'TONTINE',
      contextId: p.tontineId,
      description: p.description,
      metadata: {
        cycleId: p.cycleId,
        cycleNumber: p.cycleNumber,
        collationMinor: p.collationMinor,
        partial: p.partial,
      },
      lines,
      compliance: {
        operationType: 'TONTINE_PAYOUT',
        memberId: p.beneficiaryId,
        creditMemberId: p.beneficiaryId,
      },
    });
  }

  async topUp(p: TopUpRequested): Promise<void> {
    const amountMinor = BigInt(p.amountMinor);
    await this.execute(
      'TONTINE_PAYOUT_TOPUP',
      `payout-topup:${p.contributionId}`,
      `${p.cycleId}:${p.contributionId}:${p.amountMinor}`,
      p,
      {
        idempotencyKey: `payout-topup:${p.contributionId}`,
        type: 'PAYOUT',
        amountMinor,
        currency: p.currency,
        initiatorId: null,
        beneficiaryId: p.beneficiaryId,
        sourceWalletId: p.poolWalletId,
        destinationWalletId: p.beneficiaryWalletId,
        contextType: 'TONTINE',
        contextId: p.tontineId,
        description: p.description,
        lines: [
          {
            walletId: p.poolWalletId,
            direction: 'DEBIT',
            amountMinor,
            context: 'TONTINE_PAYOUT',
            contextRef: p.cycleId,
          },
          {
            walletId: p.beneficiaryWalletId,
            direction: 'CREDIT',
            amountMinor,
            context: 'TONTINE_PAYOUT',
            contextRef: p.tontineId,
            description: p.description,
          },
        ],
      },
    );
  }

  private async execute(
    type: 'TONTINE_PAYOUT' | 'TONTINE_PAYOUT_TOPUP',
    key: string,
    reference: string,
    request: Record<string, unknown>,
    input: ExecuteInput,
  ): Promise<void> {
    let saga = await this.sagas.begin(type, key, reference, request);
    if (saga.status !== 'STARTED') return;
    saga = await this.sagas.advance(saga, 'COMPLIANCE_AND_LEDGER');
    let transactionId: string;
    try {
      transactionId = (
        await this.transactions.execute({
          ...input,
          metadata: { ...(input.metadata ?? {}), sagaId: saga.id },
        })
      ).id;
    } catch (e) {
      if (!(e instanceof DomainError) || e.code === 'IDEMPOTENCY_IN_PROGRESS') throw e;
      await this.sagas.fail(saga, {
        code: e.code,
        reason: e.message,
        compensated: false,
        requiresReconciliation: false,
      });
      return;
    }
    await this.sagas.complete(saga, transactionId);
  }
}
