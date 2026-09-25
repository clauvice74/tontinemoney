import { Injectable } from '@nestjs/common';
import { type EventEnvelope } from '@tontine/events';
import { OnEvent } from '@tontine/platform';
import { TontinesService } from './tontines.service';

/** A-05 : passage automatique DRAFT ⇄ READY selon le nombre de participants confirmés. */
@Injectable()
export class TontinesConsumers {
  constructor(private readonly tontines: TontinesService) {}

  @OnEvent('tontine.member.added', { consumer: 'tontines.readiness-on-add' })
  async onAdded(e: EventEnvelope<'tontine.member.added'>): Promise<void> {
    await this.tontines.recomputeReadiness(e.payload.tontineId);
  }

  @OnEvent('tontine.member.removed', { consumer: 'tontines.readiness-on-remove' })
  async onRemoved(e: EventEnvelope<'tontine.member.removed'>): Promise<void> {
    await this.tontines.recomputeReadiness(e.payload.tontineId);
  }
}
