import { Injectable } from '@nestjs/common';
import { type EventEnvelope } from '@tontine/events';
import { DomainError } from '@tontine/platform';
import { WalletsService } from '@tontine/wallets';
import { TransactionsService } from '../transactions.service';
import { SagaOrchestrator } from './saga-orchestrator';

type Completed = EventEnvelope<'payment.completed'>['payload'];

/**
 * Saga de règlement d'un paiement PSP (docs/sagas.md §3, A-53) : `payment.completed` →
 * écritures partie double (dépôt : clearing PSP → membre ; retrait : capture du hold
 * membre → clearing) → `transaction.saga.completed` (Payment Service rattache la transaction).
 *
 * Échec métier (wallet gelé, hold absent…) : l'argent a déjà bougé chez le PSP, aucune
 * compensation automatique n'est possible → saga FAILED, alerte de réconciliation.
 * Erreur technique : l'exception remonte (redélivrance, puis journal des rejets).
 */
@Injectable()
export class PaymentSettlementSaga {
  constructor(
    private readonly sagas: SagaOrchestrator,
    private readonly transactions: TransactionsService,
    private readonly wallets: WalletsService,
  ) {}

  async run(p: Completed): Promise<void> {
    if (p.type !== 'DEPOSIT' && p.type !== 'WITHDRAWAL') return;
    let saga = await this.sagas.begin(
      'PAYMENT_SETTLEMENT',
      `payment-settlement:${p.paymentId}`,
      p.paymentId,
      { ...p },
    );
    if (saga.status !== 'STARTED') return;

    const walletId = p.walletId ?? (await this.wallets.memberWalletOrNull(p.memberId))?.id;
    const failure = !walletId
      ? 'Portefeuille du membre introuvable'
      : p.type === 'WITHDRAWAL' && !p.holdId
        ? 'Blocage de fonds du retrait introuvable'
        : null;
    if (failure || !walletId) {
      await this.sagas.fail(saga, {
        code: 'SETTLEMENT_INSTRUCTIONS_MISSING',
        reason: failure ?? 'Instructions de règlement incomplètes',
        compensated: false,
        requiresReconciliation: true,
      });
      return;
    }
    const amountMinor = BigInt(p.amountMinor);
    const clearing = await this.wallets.ensureSystemWallet('PSP_CLEARING', p.currency);
    const deposit = p.type === 'DEPOSIT';
    const description = p.description ?? (deposit ? 'Dépôt' : 'Retrait');
    const [from, to] = deposit ? [clearing.id, walletId] : [walletId, clearing.id];
    const context = deposit ? ('DEPOSIT' as const) : ('WITHDRAWAL' as const);
    saga = await this.sagas.advance(saga, 'LEDGER_POSTING');
    let transactionId: string;
    try {
      const t = await this.transactions.execute({
        idempotencyKey: `payment:${p.paymentId}`,
        type: p.type,
        amountMinor,
        currency: p.currency,
        initiatorId: p.memberId,
        beneficiaryId: p.memberId,
        sourceWalletId: from,
        destinationWalletId: to,
        captureHoldId: deposit ? null : (p.holdId ?? null),
        contextType: 'PAYMENT',
        contextId: p.paymentId,
        description,
        metadata: { sagaId: saga.id },
        lines: [
          {
            walletId: from,
            direction: 'DEBIT',
            amountMinor,
            context,
            contextRef: p.paymentId,
            ...(deposit ? {} : { description }),
          },
          {
            walletId: to,
            direction: 'CREDIT',
            amountMinor,
            context,
            contextRef: p.paymentId,
            ...(deposit ? { description } : {}),
          },
        ],
      });
      transactionId = t.id;
    } catch (e) {
      if (!(e instanceof DomainError) || e.code === 'IDEMPOTENCY_IN_PROGRESS') throw e;
      await this.sagas.fail(saga, {
        code: e.code,
        reason: e.message,
        compensated: false,
        requiresReconciliation: true,
      });
      return;
    }
    await this.sagas.complete(saga, transactionId);
  }
}
