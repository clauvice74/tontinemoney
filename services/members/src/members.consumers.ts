import { Injectable } from '@nestjs/common';
import { type KycLevel } from '@tontine/contracts';
import { type EventEnvelope } from '@tontine/events';
import { OnEvent } from '@tontine/platform';
import { MembersService } from './members.service';

/** Consommateurs du domaine Membres (US-2.1, US-2.6, US-9.1). */
@Injectable()
export class MembersConsumers {
  constructor(private readonly members: MembersService) {}

  @OnEvent('user.registered', { consumer: 'members.profile-creator' })
  async onUserRegistered(e: EventEnvelope<'user.registered'>): Promise<void> {
    await this.members.createFromRegistration(e.payload);
  }

  @OnEvent('user.activated', { consumer: 'members.activation' })
  async onUserActivated(e: EventEnvelope<'user.activated'>): Promise<void> {
    await this.members.onActivated(e.payload.userId);
  }

  @OnEvent('user.access.decided', { consumer: 'members.access-decision-audit' })
  async onAccessDecided(e: EventEnvelope<'user.access.decided'>): Promise<void> {
    await this.members.recordAccessDecision(
      e.payload.userId,
      e.payload.decision,
      e.payload.reason,
      null,
    );
  }

  @OnEvent('kyc.submitted', { consumer: 'members.kyc-submitted' })
  async onKycSubmitted(e: EventEnvelope<'kyc.submitted'>): Promise<void> {
    await this.members.applyTrigger(e.payload.memberId, 'kyc.submitted', {
      reason: 'Documents KYC soumis',
      changedBy: null,
      changedByRole: 'SYSTEM',
    });
  }

  @OnEvent('kyc.review.required', { consumer: 'members.kyc-review' })
  async onKycReview(e: EventEnvelope<'kyc.review.required'>): Promise<void> {
    await this.members.applyTrigger(e.payload.memberId, 'kyc.review.required', {
      reason: `Revue manuelle : ${e.payload.failedSteps.join(', ')}`,
      changedBy: null,
      changedByRole: 'SYSTEM',
    });
  }

  @OnEvent('kyc.verified', { consumer: 'members.kyc-verified' })
  async onKycVerified(e: EventEnvelope<'kyc.verified'>): Promise<void> {
    await this.members.applyTrigger(e.payload.memberId, 'kyc.verified', {
      reason: `KYC vérifié (${e.payload.verifiedBy})`,
      changedBy: null,
      changedByRole: e.payload.verifiedBy === 'auto' ? 'SYSTEM' : 'KYC_AGENT',
      kycLevel: e.payload.kycLevel as KycLevel,
    });
    if (e.payload.documentCountry)
      await this.members.setCountryFromKyc(e.payload.memberId, e.payload.documentCountry);
  }

  @OnEvent('kyc.rejected', { consumer: 'members.kyc-rejected' })
  async onKycRejected(e: EventEnvelope<'kyc.rejected'>): Promise<void> {
    await this.members.applyTrigger(e.payload.memberId, 'kyc.rejected', {
      reason: `${e.payload.rejectCategory} : ${e.payload.rejectReason}`,
      changedBy: null,
      changedByRole: e.payload.rejectedBy === 'auto' ? 'SYSTEM' : 'KYC_AGENT',
    });
  }

  @OnEvent('kyc.duplicate.detected', { consumer: 'members.kyc-duplicate' })
  async onDuplicate(e: EventEnvelope<'kyc.duplicate.detected'>): Promise<void> {
    await this.members.applyTrigger(e.payload.memberId, 'kyc.duplicate.detected', {
      reason: `Doublon biométrique potentiel (${Math.round(e.payload.similarityScore)} %)`,
      changedBy: null,
      changedByRole: 'SYSTEM',
    });
  }

  @OnEvent('kyc.duplicate.resolved', { consumer: 'members.kyc-duplicate-resolved' })
  async onDuplicateResolved(e: EventEnvelope<'kyc.duplicate.resolved'>): Promise<void> {
    if (e.payload.resolution !== 'DISMISSED') return;
    await this.members.applyTrigger(e.payload.memberId, 'duplicate.dismissed', {
      reason: 'Doublon biométrique écarté par un agent',
      changedBy: null,
      changedByRole: 'KYC_AGENT',
    });
  }

  @OnEvent('kyc.expired', { consumer: 'members.kyc-expired' })
  async onKycExpired(e: EventEnvelope<'kyc.expired'>): Promise<void> {
    await this.members.setKycLevel(
      e.payload.memberId,
      e.payload.newLevel as KycLevel,
      'kyc.expired',
    );
  }

  @OnEvent('fraud.user.flagged', { consumer: 'members.fraud' })
  async onFraud(e: EventEnvelope<'fraud.user.flagged'>): Promise<void> {
    await this.members.applyTrigger(e.payload.memberId, 'fraud.user.flagged', {
      reason: `fraude : ${e.payload.reason}`,
      changedBy: null,
      changedByRole: 'SYSTEM',
    });
  }

  @OnEvent('compliance.user.suspended', { consumer: 'members.compliance-suspended' })
  async onComplianceSuspended(e: EventEnvelope<'compliance.user.suspended'>): Promise<void> {
    await this.members.applyTrigger(e.payload.memberId, 'compliance.user.suspended', {
      reason: `conformité : ${e.payload.reason}`,
      changedBy: null,
      changedByRole: 'SYSTEM',
    });
  }

  @OnEvent('compliance.user.restricted', { consumer: 'members.compliance-restricted' })
  async onComplianceRestricted(e: EventEnvelope<'compliance.user.restricted'>): Promise<void> {
    await this.members.setComplianceStatus(e.payload.memberId, 'RESTRICTED', e.payload.reason);
  }
}
