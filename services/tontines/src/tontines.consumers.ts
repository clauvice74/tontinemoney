import { Injectable } from '@nestjs/common';
import { type EventEnvelope } from '@tontine/events';
import { OnEvent } from '@tontine/platform';
import { PayoutsService } from './payouts.service';
import { TontinesService } from './tontines.service';

/** A-05 : passage automatique DRAFT ⇄ READY selon le nombre de participants confirmés. */
@Injectable()
export class TontinesConsumers {
  constructor(
    private readonly tontines: TontinesService,
    private readonly payouts: PayoutsService,
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

  @OnEvent('tontine.member.added', { consumer: 'tontines.readiness-on-add' })
  async onAdded(e: EventEnvelope<'tontine.member.added'>): Promise<void> {
    await this.tontines.recomputeReadiness(e.payload.tontineId);
  }

  @OnEvent('tontine.member.removed', { consumer: 'tontines.readiness-on-remove' })
  async onRemoved(e: EventEnvelope<'tontine.member.removed'>): Promise<void> {
    await this.tontines.recomputeReadiness(e.payload.tontineId);
  }
}
