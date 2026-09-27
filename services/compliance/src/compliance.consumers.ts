import { Injectable } from '@nestjs/common';
import { type EventEnvelope } from '@tontine/events';
import { OnEvent } from '@tontine/platform';
import { ComplianceService } from './compliance.service';

@Injectable()
export class ComplianceConsumers {
  constructor(private readonly compliance: ComplianceService) {}

  /** Propagation multi-instances : invalidation du cache des règles (US-9.3). */
  @OnEvent('compliance.rule.updated', { consumer: 'compliance.cache-invalidation' })
  async onRuleUpdated(e: EventEnvelope<'compliance.rule.updated'>): Promise<void> {
    await this.compliance.invalidate(e.payload.country);
  }

  /** US-2.2 / US-9.4 : le changement de pays déclenche une réévaluation de conformité. */
  @OnEvent('member.updated', { consumer: 'compliance.country-change' })
  async onMemberUpdated(e: EventEnvelope<'member.updated'>): Promise<void> {
    if (!e.payload.changedFields.includes('country')) return;
    await this.compliance.onCountryChanged(
      e.payload.memberId,
      e.payload.oldValues['country'],
      e.payload.newValues['country'],
    );
  }
}
