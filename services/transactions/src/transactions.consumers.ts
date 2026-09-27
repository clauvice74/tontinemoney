import { Injectable } from '@nestjs/common';
import { type EventEnvelope } from '@tontine/events';
import { OnEvent } from '@tontine/platform';
import { ContributionSaga } from './sagas/contribution.saga';
import { PaymentSettlementSaga } from './sagas/payment-settlement.saga';
import { TontinePayoutSaga } from './sagas/tontine-payout.saga';

/** Transaction Service, orchestrateur des sagas financières (étape 5, A-53). */
@Injectable()
export class TransactionsConsumers {
  constructor(
    private readonly settlement: PaymentSettlementSaga,
    private readonly payouts: TontinePayoutSaga,
    private readonly contributions: ContributionSaga,
  ) {}

  @OnEvent('tontine.contribution.payment.requested', { consumer: 'transactions.contribution' })
  async onContributionRequested(
    e: EventEnvelope<'tontine.contribution.payment.requested'>,
  ): Promise<void> {
    await this.contributions.run(e.payload);
  }

  @OnEvent('payment.completed', { consumer: 'transactions.payment-settlement' })
  async onPaymentCompleted(e: EventEnvelope<'payment.completed'>): Promise<void> {
    await this.settlement.run(e.payload);
  }

  @OnEvent('tontine.payout.requested', { consumer: 'transactions.tontine-payout' })
  async onPayoutRequested(e: EventEnvelope<'tontine.payout.requested'>): Promise<void> {
    await this.payouts.payout(e.payload);
  }

  @OnEvent('tontine.payout.topup.requested', { consumer: 'transactions.tontine-payout-topup' })
  async onTopUpRequested(e: EventEnvelope<'tontine.payout.topup.requested'>): Promise<void> {
    await this.payouts.topUp(e.payload);
  }
}
