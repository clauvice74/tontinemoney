import { Injectable } from '@nestjs/common';
import { type EventEnvelope } from '@tontine/events';
import { OnEvent } from '@tontine/platform';
import { ConfigurationService } from './configuration.service';

@Injectable()
export class AdministrationConsumers {
  constructor(private readonly configuration: ConfigurationService) {}

  /** Plusieurs instances : chaque cache local est invalidé à la modification d'un paramètre. */
  @OnEvent('admin.configuration.updated', { consumer: 'administration.configuration-cache' })
  async onConfigurationUpdated(e: EventEnvelope<'admin.configuration.updated'>): Promise<void> {
    this.configuration.invalidate(e.payload.key);
  }
}
