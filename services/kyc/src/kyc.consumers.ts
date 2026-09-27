import { Injectable } from '@nestjs/common';
import { type EventEnvelope } from '@tontine/events';
import { OnEvent } from '@tontine/platform';
import { KycPipelineService } from './pipeline.service';

@Injectable()
export class KycConsumers {
  constructor(private readonly pipeline: KycPipelineService) {}

  /** US-3.1 §10 / US-3.2 — traitement automatique asynchrone. */
  @OnEvent('kyc.submitted', { consumer: 'kyc.pipeline' })
  async onSubmitted(e: EventEnvelope<'kyc.submitted'>): Promise<void> {
    await this.pipeline.run(e.payload.requestId);
  }
}
