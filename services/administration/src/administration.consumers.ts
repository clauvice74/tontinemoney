import { Injectable } from '@nestjs/common';
import { type EventEnvelope } from '@tontine/events';
import { OnEvent } from '@tontine/platform';
import { ReportsService } from './reports.service';

@Injectable()
export class AdministrationConsumers {
  constructor(private readonly reports: ReportsService) {}

  /** US-4.9 §4 : rapport final PDF généré automatiquement et archivé (5 ans) à la clôture. */
  @OnEvent('tontine.closed', { consumer: 'administration.final-report' })
  async onClosed(e: EventEnvelope<'tontine.closed'>): Promise<void> {
    await this.reports.archiveFinalReport(e.payload.tontineId);
  }
}
