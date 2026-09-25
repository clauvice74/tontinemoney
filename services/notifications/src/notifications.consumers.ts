import { Inject, Injectable } from '@nestjs/common';
import { formatMoney } from '@tontine/contracts';
import { type EventEnvelope, type EventType } from '@tontine/events';
import { Clock, OnEvent } from '@tontine/platform';
import { NotificationService } from './notification.service';
import {
  type RoleDirectory,
  ROLE_DIRECTORY,
  type TontineDirectory,
  TONTINE_DIRECTORY,
  type RecipientProfile,
} from './ports';
import { addDays, formatDate, localToUtc } from './time';

type E<T extends EventType> = EventEnvelope<T>;

const money = (minor: string, currency: string, lang = 'fr') =>
  formatMoney(BigInt(minor), currency, lang);

const FREQUENCY_LABELS: Record<string, { fr: string; en: string }> = {
  WEEKLY: { fr: 'par semaine', en: 'weekly' },
  BIWEEKLY: { fr: 'toutes les deux semaines', en: 'every two weeks' },
  MONTHLY: { fr: 'par mois', en: 'monthly' },
  BIMONTHLY: { fr: 'deux fois par mois', en: 'twice a month' },
};

export function frequencyLabel(freq: string, lang: string): string {
  const l = FREQUENCY_LABELS[freq];
  if (!l) return freq;
  return lang.startsWith('en') ? l.en : l.fr;
}

/**
 * Transformation des événements métier en notifications structurées (US-8.1).
 * Chaque consommateur est idempotent (dispatcher + clés de déduplication).
 */
@Injectable()
export class NotificationConsumers {
  constructor(
    private readonly notifications: NotificationService,
    private readonly clock: Clock,
    @Inject(ROLE_DIRECTORY) private readonly roles: RoleDirectory,
    @Inject(TONTINE_DIRECTORY) private readonly tontines: TontineDirectory,
  ) {}

  private base(e: EventEnvelope) {
    return { eventId: e.eventId, eventType: e.eventType, dedupeKey: `evt:${e.eventId}` };
  }

  // ---------------------------------------------------------------- Sécurité & compte
  @OnEvent('user.login', { consumer: 'notifications.user-login' })
  async onLogin(e: E<'user.login'>): Promise<void> {
    if (!e.payload.newDevice) return; // R-AUTH-LOGIN-04
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.userId],
      template: 'auth.new_device',
      vars: { appareil: e.payload.userAgent.slice(0, 60) },
    });
  }

  @OnEvent('user.locked', { consumer: 'notifications.user-locked' })
  async onLocked(e: E<'user.locked'>): Promise<void> {
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.userId],
      template: 'auth.account_locked',
      vars: {},
    });
  }

  @OnEvent('user.password.reset', { consumer: 'notifications.password-reset' })
  async onPasswordReset(e: E<'user.password.reset'>): Promise<void> {
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.userId],
      template: 'auth.password_reset_done',
      vars: {},
    });
  }

  @OnEvent('user.mfa.enabled', { consumer: 'notifications.mfa-enabled' })
  async onMfaEnabled(e: E<'user.mfa.enabled'>): Promise<void> {
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.userId],
      template: 'auth.mfa_enabled',
      vars: { mode: e.payload.mfaType === 'TOTP' ? 'application' : 'SMS' },
    });
  }

  @OnEvent('user.mfa.disabled', { consumer: 'notifications.mfa-disabled' })
  async onMfaDisabled(e: E<'user.mfa.disabled'>): Promise<void> {
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.userId],
      template: 'auth.mfa_disabled',
      vars: {},
    });
  }

  @OnEvent('user.mfa.recovery.exhausted', { consumer: 'notifications.mfa-recovery' })
  async onRecoveryExhausted(e: E<'user.mfa.recovery.exhausted'>): Promise<void> {
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.userId],
      template: 'auth.mfa_recovery_exhausted',
      vars: {},
    });
  }

  @OnEvent('user.approval.requested', { consumer: 'notifications.approval-requested' })
  async onApprovalRequested(e: E<'user.approval.requested'>): Promise<void> {
    const target = e.payload.requestedTontineId;
    const recipients = target ? await this.tontines.adminIds(target) : [];
    const tontine = target ? await this.tontines.describe(target) : null;
    const admins = recipients.length ? recipients : await this.roles.userIdsWithRole('SUPER_ADMIN');
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: admins,
      template: 'auth.access_request_received',
      vars: (r) => ({
        demandeur: r.language.startsWith('en') ? 'A new user' : 'Un nouvel utilisateur',
        cible: tontine?.name ?? (r.language.startsWith('en') ? 'the platform' : 'la plateforme'),
      }),
    });
  }

  @OnEvent('user.access.decided', { consumer: 'notifications.access-decided' })
  async onAccessDecided(e: E<'user.access.decided'>): Promise<void> {
    if (e.payload.decision === 'APPROVED') return; // le lien d'activation est envoyé directement (sendDirect)
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.userId],
      template: e.payload.decision === 'REJECTED' ? 'auth.access_rejected' : 'auth.access_expired',
      vars: { motif: e.payload.reason ?? '' },
    });
  }

  // ---------------------------------------------------------------- Membres
  @OnEvent('member.kyc.required', { consumer: 'notifications.kyc-required' })
  async onKycRequired(e: E<'member.kyc.required'>): Promise<void> {
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.memberId],
      template: 'member.kyc_required',
      vars: {},
    });
  }

  @OnEvent('member.suspended', { consumer: 'notifications.member-suspended' })
  async onSuspended(e: E<'member.suspended'>): Promise<void> {
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.memberId],
      template: 'member.suspended',
      vars: { motif: e.payload.reason },
    });
  }

  @OnEvent('member.reactivated', { consumer: 'notifications.member-reactivated' })
  async onReactivated(e: E<'member.reactivated'>): Promise<void> {
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.memberId],
      template: 'member.reactivated',
      vars: {},
    });
  }

  @OnEvent('member.decision', { consumer: 'notifications.member-decision' })
  async onMemberDecision(e: E<'member.decision'>): Promise<void> {
    const t = await this.tontines.describe(e.payload.tontineId);
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.memberId],
      template: e.payload.decision === 'ACCEPTED' ? 'member.accepted' : 'member.rejected',
      vars: { tontine: t?.name ?? '', motif: e.payload.reason ?? '' },
    });
  }

  // ---------------------------------------------------------------- KYC
  @OnEvent('kyc.submitted', { consumer: 'notifications.kyc-submitted' })
  async onKycSubmitted(e: E<'kyc.submitted'>): Promise<void> {
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.memberId],
      template: 'kyc.submitted',
      vars: {},
    });
  }

  @OnEvent('kyc.verified', { consumer: 'notifications.kyc-verified' })
  async onKycVerified(e: E<'kyc.verified'>): Promise<void> {
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.memberId],
      template: 'kyc.verified',
      vars: { niveau: e.payload.kycLevel.replace('TIER_', '') },
    });
  }

  @OnEvent('kyc.rejected', { consumer: 'notifications.kyc-rejected' })
  async onKycRejected(e: E<'kyc.rejected'>): Promise<void> {
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.memberId],
      template: 'kyc.rejected',
      vars: { categorie: e.payload.rejectCategory, motif: e.payload.rejectReason },
    });
  }

  @OnEvent('kyc.review.required', { consumer: 'notifications.kyc-review' })
  async onKycReview(e: E<'kyc.review.required'>): Promise<void> {
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.memberId],
      template: 'kyc.in_review',
      vars: {},
    });
    const agents = await this.roles.userIdsWithRole('KYC_AGENT');
    await this.notifications.notify({
      eventId: e.eventId,
      eventType: e.eventType,
      dedupeKey: `evt:${e.eventId}:agents`,
      recipientIds: agents,
      template: 'kyc.review_queue',
      vars: { etapes: e.payload.failedSteps.join(', ') },
    });
  }

  @OnEvent('kyc.supplement.requested', { consumer: 'notifications.kyc-supplement' })
  async onKycSupplement(e: E<'kyc.supplement.requested'>): Promise<void> {
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.memberId],
      template: 'kyc.supplement_requested',
      vars: { message: e.payload.message },
    });
  }

  @OnEvent('kyc.expiring', { consumer: 'notifications.kyc-expiring' })
  async onKycExpiring(e: E<'kyc.expiring'>): Promise<void> {
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.memberId],
      template: e.payload.daysLeft <= 7 ? 'kyc.expiring_7' : 'kyc.expiring_30',
      vars: { jours: e.payload.daysLeft },
    });
  }

  @OnEvent('kyc.expired', { consumer: 'notifications.kyc-expired' })
  async onKycExpired(e: E<'kyc.expired'>): Promise<void> {
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.memberId],
      template: 'kyc.expired',
      vars: {},
    });
  }

  @OnEvent('kyc.operations.suspended', { consumer: 'notifications.kyc-ops-suspended' })
  async onKycOpsSuspended(e: E<'kyc.operations.suspended'>): Promise<void> {
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.memberId],
      template: 'kyc.operations_suspended',
      vars: {},
    });
  }

  @OnEvent('kyc.duplicate.detected', { consumer: 'notifications.kyc-duplicate' })
  async onKycDuplicate(e: E<'kyc.duplicate.detected'>): Promise<void> {
    const staff = [
      ...(await this.roles.userIdsWithRole('KYC_AGENT')),
      ...(await this.roles.userIdsWithRole('SUPER_ADMIN')),
    ];
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: staff,
      template: 'kyc.duplicate_alert',
      vars: { score: Math.round(e.payload.similarityScore) },
    });
  }

  // ---------------------------------------------------------------- Tontines
  private async tontineName(id: string): Promise<{ name: string; currency: string }> {
    const t = await this.tontines.describe(id);
    return { name: t?.name ?? '', currency: t?.currency ?? 'XAF' };
  }

  @OnEvent('tontine.member.added', { consumer: 'notifications.tontine-member-added' })
  async onTontineMemberAdded(e: E<'tontine.member.added'>): Promise<void> {
    const t = await this.tontineName(e.payload.tontineId);
    const admins = (await this.tontines.adminIds(e.payload.tontineId)).filter(
      (id) => id !== e.payload.memberId,
    );
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: admins,
      template: 'tontine.member_added',
      vars: { tontine: t.name },
    });
  }

  @OnEvent('tontine.ready', { consumer: 'notifications.tontine-ready' })
  async onTontineReady(e: E<'tontine.ready'>): Promise<void> {
    const t = await this.tontineName(e.payload.tontineId);
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: await this.tontines.adminIds(e.payload.tontineId),
      template: 'tontine.ready',
      vars: { tontine: t.name, nombre: e.payload.memberCount },
    });
  }

  @OnEvent('tontine.start.blocked', { consumer: 'notifications.tontine-start-blocked' })
  async onStartBlocked(e: E<'tontine.start.blocked'>): Promise<void> {
    const t = await this.tontineName(e.payload.tontineId);
    await this.notifications.notify({
      eventId: e.eventId,
      eventType: e.eventType,
      // Une alerte par jour au maximum
      dedupeKey: `start-blocked:${e.payload.tontineId}:${this.clock.today()}`,
      recipientIds: await this.tontines.adminIds(e.payload.tontineId),
      template: 'tontine.start_blocked',
      vars: { tontine: t.name, blocages: e.payload.blockers.join(' ; ') },
    });
  }

  @OnEvent('tontine.started', { consumer: 'notifications.tontine-started' })
  async onTontineStarted(e: E<'tontine.started'>): Promise<void> {
    const t = await this.tontineName(e.payload.tontineId);
    const participants = await this.tontines.participantIds(e.payload.tontineId);
    const names = await this.firstNames([e.payload.firstBeneficiaryId]);
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: participants,
      template: 'tontine.started',
      vars: { tontine: t.name, beneficiaire: names.get(e.payload.firstBeneficiaryId) ?? '' },
    });
  }

  @OnEvent('tontine.cycle.started', { consumer: 'notifications.cycle-started' })
  async onCycleStarted(e: E<'tontine.cycle.started'>): Promise<void> {
    const t = await this.tontineName(e.payload.tontineId);
    const participants = await this.tontines.participantIds(e.payload.tontineId);
    const names = e.payload.beneficiaryId
      ? await this.firstNames([e.payload.beneficiaryId])
      : new Map<string, string>();
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: participants,
      template: 'tontine.cycle_started',
      vars: (r) => ({
        tontine: t.name,
        numero: e.payload.cycleNumber,
        beneficiaire: e.payload.beneficiaryId ? (names.get(e.payload.beneficiaryId) ?? '') : '—',
        dateLimite: formatDate(e.payload.dueDate, r.language),
      }),
    });
  }

  /** US-4.4 + US-8.4 : échéance notifiée et rappels J-3, J-1, J (9 h, fuseau du membre). */
  @OnEvent('tontine.contribution.due', { consumer: 'notifications.contribution-due' })
  async onContributionDue(e: E<'tontine.contribution.due'>): Promise<void> {
    const t = await this.tontineName(e.payload.tontineId);
    const vars = (r: RecipientProfile) => ({
      tontine: t.name,
      montant: money(e.payload.amountMinor, e.payload.currency, r.language),
      dateLimite: formatDate(e.payload.dueDate, r.language),
    });
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.memberId],
      template: 'tontine.contribution_due',
      vars,
    });
    const [recipient] = await this.notifications.recipients([e.payload.memberId]);
    if (!recipient) return;
    const now = this.clock.now();
    const reminders: Array<{ offset: number; fr: string; en: string }> = [
      { offset: -3, fr: 'dans 3 jours', en: 'in 3 days' },
      { offset: -1, fr: 'demain', en: 'tomorrow' },
      { offset: 0, fr: 'aujourd’hui', en: 'today' },
    ];
    for (const rem of reminders) {
      // 9 h dans le fuseau du membre (R-NOT-03)
      const at = localToUtc(addDays(e.payload.dueDate, rem.offset), '09:00', recipient.timezone);
      if (at <= now) continue;
      await this.notifications.notify({
        eventId: e.eventId,
        eventType: e.eventType,
        dedupeKey: `reminder:${e.payload.contributionId}:${rem.offset}`,
        recipientIds: [e.payload.memberId],
        template: 'tontine.contribution_reminder',
        priority: rem.offset === 0 ? 'HIGH' : 'MEDIUM',
        channels: ['SMS'],
        scheduledFor: at,
        vars: (r) => ({ ...vars(r), echeance: r.language.startsWith('en') ? rem.en : rem.fr }),
      });
    }
  }

  @OnEvent('tontine.contribution.received', { consumer: 'notifications.contribution-received' })
  async onContributionReceived(e: E<'tontine.contribution.received'>): Promise<void> {
    // US-8.4 : annulation des rappels si le paiement est reçu avant.
    await this.notifications.cancelScheduled(`reminder:${e.payload.contributionId}:`);
    const t = await this.tontineName(e.payload.tontineId);
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.memberId],
      template: 'tontine.contribution_received',
      vars: (r) => ({
        tontine: t.name,
        montant: money(e.payload.amountMinor, t.currency, r.language),
      }),
    });
  }

  @OnEvent('tontine.contribution.late', { consumer: 'notifications.contribution-late' })
  async onContributionLate(e: E<'tontine.contribution.late'>): Promise<void> {
    const t = await this.tontineName(e.payload.tontineId);
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.memberId],
      template: 'tontine.contribution_late',
      vars: (r) => ({
        tontine: t.name,
        penalite: money(e.payload.penaltyMinor, e.payload.currency, r.language),
      }),
    });
  }

  @OnEvent('tontine.contribution.defaulted', { consumer: 'notifications.contribution-defaulted' })
  async onContributionDefaulted(e: E<'tontine.contribution.defaulted'>): Promise<void> {
    const t = await this.tontineName(e.payload.tontineId);
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.memberId],
      template: 'tontine.contribution_defaulted',
      vars: { tontine: t.name },
    });
  }

  @OnEvent('tontine.member.suspended', { consumer: 'notifications.tontine-member-suspended' })
  async onTontineMemberSuspended(e: E<'tontine.member.suspended'>): Promise<void> {
    const t = await this.tontineName(e.payload.tontineId);
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.memberId, ...(await this.tontines.adminIds(e.payload.tontineId))],
      template: 'tontine.member_suspended',
      vars: { tontine: t.name, defauts: e.payload.consecutiveDefaults },
    });
  }

  @OnEvent('tontine.payout.initiated', { consumer: 'notifications.payout' })
  async onPayout(e: E<'tontine.payout.initiated'>): Promise<void> {
    const t = await this.tontineName(e.payload.tontineId);
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.beneficiaryId],
      template: 'tontine.payout_received',
      vars: (r) => ({
        tontine: t.name,
        montant: money(e.payload.totalMinor, e.payload.currency, r.language),
      }),
    });
  }

  @OnEvent('tontine.cycle.completed', { consumer: 'notifications.cycle-completed' })
  async onCycleCompleted(e: E<'tontine.cycle.completed'>): Promise<void> {
    const t = await this.tontineName(e.payload.tontineId);
    const names = await this.firstNames([e.payload.beneficiaryId]);
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: await this.tontines.participantIds(e.payload.tontineId),
      template: 'tontine.cycle_completed',
      vars: {
        tontine: t.name,
        numero: e.payload.cycleNumber,
        prenom: names.get(e.payload.beneficiaryId) ?? '',
      },
    });
  }

  @OnEvent('tontine.closed', { consumer: 'notifications.tontine-closed' })
  async onClosed(e: E<'tontine.closed'>): Promise<void> {
    const t = await this.tontineName(e.payload.tontineId);
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: await this.tontines.participantIds(e.payload.tontineId),
      template: 'tontine.closed',
      vars: { tontine: t.name },
    });
  }

  @OnEvent('tontine.closure.blocked', { consumer: 'notifications.closure-blocked' })
  async onClosureBlocked(e: E<'tontine.closure.blocked'>): Promise<void> {
    const t = await this.tontineName(e.payload.tontineId);
    await this.notifications.notify({
      eventId: e.eventId,
      eventType: e.eventType,
      dedupeKey: `closure-blocked:${e.payload.tontineId}:${this.clock.today()}`,
      recipientIds: await this.tontines.adminIds(e.payload.tontineId),
      template: 'tontine.closure_blocked',
      vars: { tontine: t.name, blocages: e.payload.blockers.join(' ; ') },
    });
  }

  @OnEvent(['tontine.paused', 'tontine.resumed', 'tontine.cancelled'], {
    consumer: 'notifications.tontine-status',
  })
  async onTontineStatus(
    e: E<'tontine.paused'> | E<'tontine.resumed'> | E<'tontine.cancelled'>,
  ): Promise<void> {
    const t = await this.tontineName(e.payload.tontineId);
    const template =
      e.eventType === 'tontine.paused'
        ? 'tontine.paused'
        : e.eventType === 'tontine.resumed'
          ? 'tontine.resumed'
          : 'tontine.cancelled';
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: await this.tontines.participantIds(e.payload.tontineId),
      template,
      vars: { tontine: t.name, motif: e.payload.reason },
    });
  }

  // ---------------------------------------------------------------- Paiements & wallet
  private operationLabel(type: string, lang: string): string {
    const fr: Record<string, string> = {
      DEPOSIT: 'dépôt',
      WITHDRAWAL: 'retrait',
      REFUND: 'remboursement',
    };
    const en: Record<string, string> = {
      DEPOSIT: 'deposit',
      WITHDRAWAL: 'withdrawal',
      REFUND: 'refund',
    };
    return (lang.startsWith('en') ? en : fr)[type] ?? type.toLowerCase();
  }

  @OnEvent('payment.completed', { consumer: 'notifications.payment-completed' })
  async onPaymentCompleted(e: E<'payment.completed'>): Promise<void> {
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.memberId],
      template: 'payment.completed',
      vars: (r) => ({
        operation: this.operationLabel(e.payload.type, r.language),
        montant: money(e.payload.amountMinor, e.payload.currency, r.language),
      }),
    });
  }

  @OnEvent('payment.failed', { consumer: 'notifications.payment-failed' })
  async onPaymentFailed(e: E<'payment.failed'>): Promise<void> {
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.memberId],
      template: 'payment.failed',
      vars: (r) => ({
        operation: this.operationLabel(e.payload.type, r.language),
        montant: '',
        motif: e.payload.reason,
      }),
    });
  }

  @OnEvent('payment.expired', { consumer: 'notifications.payment-expired' })
  async onPaymentExpired(e: E<'payment.expired'>): Promise<void> {
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.memberId],
      template: 'payment.expired',
      vars: (r) => ({ operation: this.operationLabel(e.payload.type, r.language), montant: '' }),
    });
  }

  @OnEvent('payment.refunded', { consumer: 'notifications.payment-refunded' })
  async onPaymentRefunded(e: E<'payment.refunded'>): Promise<void> {
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.memberId],
      template: 'payment.refunded',
      vars: (r) => ({ montant: money(e.payload.amountMinor, e.payload.currency, r.language) }),
    });
  }

  @OnEvent('wallet.balance.updated', { consumer: 'notifications.wallet-credited' })
  async onWalletUpdated(e: E<'wallet.balance.updated'>): Promise<void> {
    if (
      !e.payload.memberId ||
      e.payload.movementType !== 'CREDIT' ||
      e.payload.context !== 'TRANSFER'
    )
      return;
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.memberId],
      template: 'wallet.credited',
      vars: (r) => ({
        montant: money(e.payload.amountMinor, e.payload.currency, r.language),
        operation: r.language.startsWith('en') ? 'transfer' : 'transfert',
      }),
    });
  }

  @OnEvent('wallet.debit.failed', { consumer: 'notifications.wallet-debit-failed' })
  async onDebitFailed(e: E<'wallet.debit.failed'>): Promise<void> {
    if (!e.payload.memberId) return;
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.memberId],
      template: 'wallet.debit_failed',
      vars: { montant: '', motif: e.payload.reason },
    });
  }

  @OnEvent('transaction.reversed', { consumer: 'notifications.transaction-reversed' })
  async onReversed(e: E<'transaction.reversed'>): Promise<void> {
    if (!e.payload.initiatorId) return;
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.initiatorId],
      template: 'transaction.reversed',
      vars: { motif: e.payload.reason },
    });
  }

  // ---------------------------------------------------------------- Conformité, fraude, opérations
  @OnEvent('compliance.violation.detected', { consumer: 'notifications.compliance-violation' })
  async onViolation(e: E<'compliance.violation.detected'>): Promise<void> {
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.memberId],
      template: 'compliance.violation',
      vars: { regle: e.payload.ruleCode },
    });
  }

  @OnEvent('fraud.user.flagged', { consumer: 'notifications.fraud-flagged' })
  async onFraud(e: E<'fraud.user.flagged'>): Promise<void> {
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: [e.payload.memberId],
      template: 'fraud.flagged',
      vars: {},
    });
  }

  @OnEvent('reconciliation.completed', { consumer: 'notifications.reconciliation' })
  async onReconciliation(e: E<'reconciliation.completed'>): Promise<void> {
    if (!e.payload.alert) return;
    await this.notifications.notify({
      ...this.base(e),
      recipientIds: await this.roles.userIdsWithRole('SUPER_ADMIN'),
      template: 'ops.alert',
      vars: {
        message: `Réconciliation ${e.payload.kind} : ${e.payload.discrepancies} écart(s) au-delà du seuil (rapport ${e.payload.reportId}).`,
      },
    });
  }

  private async firstNames(ids: string[]): Promise<Map<string, string>> {
    const profiles = await this.notifications.recipients(ids);
    return new Map(profiles.map((p) => [p.id, p.firstName]));
  }
}
