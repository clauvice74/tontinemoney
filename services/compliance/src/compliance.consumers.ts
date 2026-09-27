import { Injectable } from '@nestjs/common';
import { type EventEnvelope } from '@tontine/events';
import { OnEvent } from '@tontine/platform';
import { ComplianceCasesService } from './cases.service';
import { ComplianceService } from './compliance.service';
import { amlSeverity } from './domain/risk';

@Injectable()
export class ComplianceConsumers {
  constructor(
    private readonly compliance: ComplianceService,
    private readonly cases: ComplianceCasesService,
  ) {}

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

  // --- Dossiers de conformité : chaque alerte est rattachée au dossier ouvert du membre ---

  @OnEvent('kyc.aml.match', { consumer: 'compliance.case-aml' })
  async onAmlMatch(e: EventEnvelope<'kyc.aml.match'>): Promise<void> {
    const p = e.payload;
    await this.cases.attachAlert({
      memberId: p.memberId,
      caseType: 'AML_SCREENING',
      alertType: 'AML_MATCH',
      sourceId: p.matchId,
      summary: { listName: p.listName, score: p.score },
      open: true,
      severity: amlSeverity(p.listName, p.score),
    });
  }

  @OnEvent('kyc.aml.resolved', { consumer: 'compliance.case-aml-resolved' })
  async onAmlResolved(e: EventEnvelope<'kyc.aml.resolved'>): Promise<void> {
    await this.cases.resolveAlert('AML_MATCH', e.payload.matchId);
  }

  @OnEvent('kyc.duplicate.detected', { consumer: 'compliance.case-duplicate' })
  async onDuplicate(e: EventEnvelope<'kyc.duplicate.detected'>): Promise<void> {
    const p = e.payload;
    await this.cases.attachAlert({
      memberId: p.memberId,
      caseType: 'DUPLICATE_IDENTITY',
      alertType: 'DUPLICATE_ALERT',
      sourceId: p.alertId,
      summary: { duplicateOfMemberId: p.duplicateOfMemberId, similarityScore: p.similarityScore },
      open: true,
      severity: 'HIGH',
    });
  }

  @OnEvent('kyc.duplicate.resolved', { consumer: 'compliance.case-duplicate-resolved' })
  async onDuplicateResolved(e: EventEnvelope<'kyc.duplicate.resolved'>): Promise<void> {
    await this.cases.resolveAlert('DUPLICATE_ALERT', e.payload.alertId);
  }

  @OnEvent('compliance.violation.detected', { consumer: 'compliance.case-violation' })
  async onViolation(e: EventEnvelope<'compliance.violation.detected'>): Promise<void> {
    const p = e.payload;
    await this.cases.attachAlert({
      memberId: p.memberId,
      caseType: 'RULE_VIOLATION',
      alertType: 'VIOLATION',
      sourceId: p.violationId,
      summary: { operationType: p.operationType, ruleCode: p.ruleCode, action: p.action },
      open: false,
      severity: 'LOW',
    });
  }

  @OnEvent('fraud.user.flagged', { consumer: 'compliance.case-fraud' })
  async onFraud(e: EventEnvelope<'fraud.user.flagged'>): Promise<void> {
    const p = e.payload;
    await this.cases.attachAlert({
      memberId: p.memberId,
      caseType: 'FRAUD',
      alertType: 'FRAUD_FLAG',
      sourceId: e.eventId,
      summary: { reason: p.reason, flaggedBy: p.flaggedBy },
      open: false,
      severity: 'CRITICAL',
    });
  }
}
