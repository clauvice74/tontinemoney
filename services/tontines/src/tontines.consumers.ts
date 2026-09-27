import { Injectable } from '@nestjs/common';
import { type EventEnvelope } from '@tontine/events';
import { OnEvent } from '@tontine/platform';
import { ContributionsService } from './contributions.service';
import { PayoutsService } from './payouts.service';
import { TontinesService } from './tontines.service';

/** A-05 : passage automatique DRAFT ⇄ READY selon le nombre de participants confirmés. */
@Injectable()
export class TontinesConsumers {
  constructor(
    private readonly tontines: TontinesService,
    private readonly payouts: PayoutsService,
    private readonly contributions: ContributionsService,
  ) {}

  /** US-4.7 : le pot est payé dès que toutes les contributions du cycle sont reçues. */
  @OnEvent('tontine.contribution.received', { consumer: 'tontines.payout-trigger' })
  async onContributionReceived(e: EventEnvelope<'tontine.contribution.received'>): Promise<void> {
    await this.payouts.onContributionReceived(
      e.payload.cycleId,
      e.payload.contributionId,
      BigInt(e.payload.amountMinor),
    );
  }

  /** Issue des sagas de contribution et de paiement du pot (Transaction Service, A-53). */
  @OnEvent('transaction.saga.completed', { consumer: 'tontines.payout-result' })
  async onSagaCompleted(e: EventEnvelope<'transaction.saga.completed'>): Promise<void> {
    const { sagaType, reference, transactionId } = e.payload;
    if (sagaType === 'CONTRIBUTION') {
      const [contributionId, requestId] = reference.split(':');
      if (contributionId && requestId)
        await this.contributions.completePayment(contributionId, requestId, transactionId);
    }
    if (sagaType === 'TONTINE_PAYOUT') await this.payouts.completePayout(reference, transactionId);
    if (sagaType === 'TONTINE_PAYOUT_TOPUP') {
      const [cycleId, , amountMinor] = reference.split(':');
      if (cycleId && amountMinor) await this.payouts.completeTopUp(cycleId, BigInt(amountMinor));
    }
  }

  @OnEvent('transaction.saga.failed', { consumer: 'tontines.payout-result' })
  async onSagaFailed(e: EventEnvelope<'transaction.saga.failed'>): Promise<void> {
    const { sagaType, reference, failureCode, failureReason } = e.payload;
    if (sagaType === 'CONTRIBUTION') {
      const [contributionId, requestId] = reference.split(':');
      if (contributionId && requestId)
        await this.contributions.paymentFailed(contributionId, requestId, failureReason);
    }
    if (sagaType === 'TONTINE_PAYOUT')
      await this.payouts.payoutFailed(reference, failureCode, failureReason);
    if (sagaType === 'TONTINE_PAYOUT_TOPUP') {
      const [cycleId] = reference.split(':');
      if (cycleId) await this.payouts.topUpFailed(cycleId, failureCode, failureReason);
    }
  }

  @OnEvent('tontine.member.added', { consumer: 'tontines.readiness-on-add' })
  async onAdded(e: EventEnvelope<'tontine.member.added'>): Promise<void> {
    await this.tontines.recomputeReadiness(e.payload.tontineId);
  }

  @OnEvent('tontine.member.removed', { consumer: 'tontines.readiness-on-remove' })
  async onRemoved(e: EventEnvelope<'tontine.member.removed'>): Promise<void> {
    await this.tontines.recomputeReadiness(e.payload.tontineId);
  }
}
