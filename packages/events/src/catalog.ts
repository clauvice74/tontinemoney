import { z } from 'zod';

/**
 * Catalogue versionné des événements (docs/event-catalog.md).
 * Chaque entrée : producteur, version courante, schéma zod du payload.
 * Règles : pas de secret, montants en unités mineures sous forme de chaîne.
 */

const id = z.string().uuid();
const minor = z.string().regex(/^-?\d+$/);
const currency = z.string().length(3);
const nullableId = id.nullable();

function def<P extends z.ZodTypeAny>(producer: string, payload: P, version = 1) {
  return { producer, version, payload };
}

export const EVENT_CATALOG = {
  // --- auth ---
  'user.registered': def(
    'auth',
    z.object({
      userId: id,
      firstName: z.string(),
      lastName: z.string(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
      country: z.string().nullable(),
      language: z.string().nullable(),
      role: z.string(),
      preferredChannel: z.string().nullable(),
      registeredBy: nullableId,
      tontineId: nullableId,
    }),
  ),
  'user.approval.requested': def(
    'auth',
    z.object({ userId: id, requestId: id, requestedTontineId: nullableId }),
  ),
  'user.activated': def('auth', z.object({ userId: id })),
  'user.login': def(
    'auth',
    z.object({
      userId: id,
      ip: z.string(),
      userAgent: z.string(),
      mfaUsed: z.boolean(),
      newDevice: z.boolean(),
    }),
  ),
  'user.logout': def('auth', z.object({ userId: id, sessionId: id })),
  'user.locked': def(
    'auth',
    z.object({ userId: id, reason: z.string(), attemptCount: z.number().int() }),
  ),
  'user.unlocked': def('auth', z.object({ userId: id, unlockedBy: id })),
  'user.password.reset': def('auth', z.object({ userId: id })),
  'user.mfa.enabled': def('auth', z.object({ userId: id, mfaType: z.enum(['TOTP', 'SMS']) })),
  'user.mfa.disabled': def('auth', z.object({ userId: id, mfaType: z.enum(['TOTP', 'SMS']) })),
  'user.mfa.recovery.exhausted': def('auth', z.object({ userId: id })),
  'user.access.decided': def(
    'auth',
    z.object({
      userId: id,
      requestId: id,
      decision: z.enum(['APPROVED', 'REJECTED', 'EXPIRED']),
      reason: z.string().nullable(),
    }),
  ),
  'user.security.alert': def(
    'auth',
    z.object({ userId: id, kind: z.string(), detail: z.string() }),
  ),

  // --- members ---
  'member.created': def(
    'members',
    z.object({
      memberId: id,
      country: z.string().nullable(),
      language: z.string(),
      status: z.string(),
      currency: currency.nullable(),
    }),
  ),
  'member.updated': def(
    'members',
    z.object({
      memberId: id,
      changedFields: z.array(z.string()),
      oldValues: z.record(z.string(), z.unknown()),
      newValues: z.record(z.string(), z.unknown()),
    }),
  ),
  'member.status.changed': def(
    'members',
    z.object({
      memberId: id,
      oldStatus: z.string(),
      newStatus: z.string(),
      reason: z.string(),
      changedBy: z.string(),
    }),
  ),
  'member.kyc.required': def('members', z.object({ memberId: id })),
  'member.suspended': def(
    'members',
    z.object({ memberId: id, reason: z.string(), suspendedBy: z.string() }),
  ),
  'member.reactivated': def(
    'members',
    z.object({ memberId: id, reason: z.string(), reactivatedBy: z.string() }),
  ),
  'member.decision': def(
    'members',
    z.object({
      memberId: id,
      tontineId: id,
      decision: z.enum(['ACCEPTED', 'REJECTED']),
      reason: z.string().nullable(),
      decidedBy: id,
    }),
  ),

  // --- kyc ---
  'kyc.submitted': def(
    'kyc',
    z.object({
      memberId: id,
      requestId: id,
      kycLevel: z.string(),
      documentTypes: z.array(z.string()),
    }),
  ),
  'kyc.verified': def(
    'kyc',
    z.object({
      memberId: id,
      requestId: id,
      kycLevel: z.string(),
      verifiedAt: z.string(),
      verifiedBy: z.string(),
      documentCountry: z.string().nullable(),
    }),
  ),
  'kyc.rejected': def(
    'kyc',
    z.object({
      memberId: id,
      requestId: id,
      rejectCategory: z.string(),
      rejectReason: z.string(),
      rejectedBy: z.string(),
    }),
  ),
  'kyc.review.required': def(
    'kyc',
    z.object({
      memberId: id,
      requestId: id,
      failedSteps: z.array(z.string()),
      scores: z.record(z.string(), z.number()),
    }),
  ),
  'kyc.supplement.requested': def(
    'kyc',
    z.object({ memberId: id, requestId: id, message: z.string() }),
  ),
  'kyc.expiring': def('kyc', z.object({ memberId: id, requestId: id, daysLeft: z.number().int() })),
  'kyc.expired': def(
    'kyc',
    z.object({ memberId: id, requestId: id, expirationDate: z.string(), newLevel: z.string() }),
  ),
  'kyc.operations.suspended': def('kyc', z.object({ memberId: id, requestId: id })),
  'kyc.duplicate.detected': def(
    'kyc',
    z.object({ memberId: id, duplicateOfMemberId: id, similarityScore: z.number(), alertId: id }),
  ),
  'kyc.duplicate.resolved': def(
    'kyc',
    z.object({ memberId: id, alertId: id, resolution: z.enum(['CONFIRMED', 'DISMISSED']) }),
  ),
  'kyc.aml.match': def(
    'kyc',
    z.object({ memberId: id, matchId: id, listName: z.string(), score: z.number() }),
  ),

  // --- tontines ---
  'tontine.created': def(
    'tontines',
    z.object({
      tontineId: id,
      createdBy: id,
      type: z.string(),
      params: z.record(z.string(), z.unknown()),
    }),
  ),
  'tontine.invitation.sent': def(
    'tontines',
    z.object({ tontineId: id, invitationId: id, channel: z.string(), invitedUserId: nullableId }),
  ),
  'tontine.member.added': def(
    'tontines',
    z.object({ tontineId: id, memberId: id, position: z.number().int().nullable() }),
  ),
  'tontine.member.removed': def(
    'tontines',
    z.object({ tontineId: id, memberId: id, reason: z.string() }),
  ),
  'tontine.member.suspended': def(
    'tontines',
    z.object({ tontineId: id, memberId: id, consecutiveDefaults: z.number().int() }),
  ),
  'tontine.ready': def('tontines', z.object({ tontineId: id, memberCount: z.number().int() })),
  'tontine.start.blocked': def(
    'tontines',
    z.object({ tontineId: id, blockers: z.array(z.string()) }),
  ),
  'tontine.started': def(
    'tontines',
    z.object({
      tontineId: id,
      memberCount: z.number().int(),
      firstBeneficiaryId: id,
      drawProof: z.string().nullable(),
    }),
  ),
  'tontine.cycle.started': def(
    'tontines',
    z.object({
      tontineId: id,
      cycleId: id,
      cycleNumber: z.number().int(),
      beneficiaryId: nullableId,
      dueDate: z.string(),
    }),
  ),
  'tontine.contribution.due': def(
    'tontines',
    z.object({
      tontineId: id,
      cycleId: id,
      contributionId: id,
      memberId: id,
      amountMinor: minor,
      currency,
      dueDate: z.string(),
    }),
  ),
  'tontine.contribution.received': def(
    'tontines',
    z.object({
      tontineId: id,
      cycleId: id,
      contributionId: id,
      memberId: id,
      amountMinor: minor,
      transactionId: id,
    }),
  ),
  'tontine.contribution.late': def(
    'tontines',
    z.object({
      tontineId: id,
      cycleId: id,
      contributionId: id,
      memberId: id,
      penaltyMinor: minor,
      currency,
    }),
  ),
  'tontine.contribution.defaulted': def(
    'tontines',
    z.object({ tontineId: id, cycleId: id, contributionId: id, memberId: id }),
  ),
  'tontine.payout.initiated': def(
    'tontines',
    z.object({
      tontineId: id,
      cycleId: id,
      beneficiaryId: id,
      totalMinor: minor,
      currency,
      partial: z.boolean(),
    }),
  ),
  'tontine.cycle.completed': def(
    'tontines',
    z.object({
      tontineId: id,
      cycleId: id,
      cycleNumber: z.number().int(),
      beneficiaryId: id,
      totalMinor: minor,
      currency,
    }),
  ),
  'tontine.paused': def('tontines', z.object({ tontineId: id, reason: z.string() })),
  'tontine.resumed': def('tontines', z.object({ tontineId: id, reason: z.string() })),
  'tontine.cancelled': def('tontines', z.object({ tontineId: id, reason: z.string() })),
  'tontine.closed': def(
    'tontines',
    z.object({ tontineId: id, totalCycles: z.number().int(), totalMinor: minor, currency }),
  ),
  'tontine.closure.blocked': def(
    'tontines',
    z.object({ tontineId: id, blockers: z.array(z.string()) }),
  ),

  // --- wallets ---
  'wallet.created': def('wallets', z.object({ walletId: id, memberId: nullableId, currency })),
  'wallet.balance.updated': def(
    'wallets',
    z.object({
      walletId: id,
      memberId: nullableId,
      oldBalanceMinor: minor,
      newBalanceMinor: minor,
      movementType: z.string(),
      amountMinor: minor,
      currency,
      context: z.string(),
      transactionId: id,
    }),
  ),
  'wallet.hold.created': def(
    'wallets',
    z.object({
      walletId: id,
      holdId: id,
      amountMinor: minor,
      context: z.string(),
      referenceId: z.string().nullable(),
    }),
  ),
  'wallet.hold.released': def(
    'wallets',
    z.object({
      walletId: id,
      holdId: id,
      amountMinor: minor,
      outcome: z.enum(['RELEASED', 'CAPTURED']),
    }),
  ),
  'wallet.hold.expired': def(
    'wallets',
    z.object({
      walletId: id,
      holdId: id,
      amountMinor: minor,
      context: z.string(),
      referenceId: z.string().nullable(),
    }),
  ),
  'wallet.debit.failed': def(
    'wallets',
    z.object({ walletId: id, memberId: nullableId, reason: z.string(), requestedMinor: minor }),
  ),
  'wallet.status.changed': def(
    'wallets',
    z.object({ walletId: id, oldStatus: z.string(), newStatus: z.string(), reason: z.string() }),
  ),

  // --- transactions ---
  'transaction.initiated': def(
    'transactions',
    z.object({
      txId: id,
      type: z.string(),
      amountMinor: minor,
      currency,
      initiatorId: nullableId,
      beneficiaryId: nullableId,
      contextType: z.string(),
      contextId: z.string().nullable(),
    }),
  ),
  'transaction.validated': def('transactions', z.object({ txId: id })),
  'transaction.completed': def(
    'transactions',
    z.object({ txId: id, type: z.string(), completedAt: z.string(), movementIds: z.array(id) }),
  ),
  'transaction.rejected': def(
    'transactions',
    z.object({
      txId: id,
      initiatorId: nullableId,
      rejectionRule: z.string(),
      rejectionReason: z.string(),
    }),
  ),
  'transaction.failed': def(
    'transactions',
    z.object({
      txId: id,
      initiatorId: nullableId,
      failureCode: z.string(),
      failureReason: z.string(),
    }),
  ),
  'transaction.reversed': def(
    'transactions',
    z.object({ txId: id, reversalTxId: id, reason: z.string(), initiatorId: nullableId }),
  ),
  'reconciliation.completed': def(
    'transactions',
    z.object({
      reportId: id,
      kind: z.string(),
      discrepancies: z.number().int(),
      alert: z.boolean(),
    }),
  ),

  // --- payments ---
  'payment.initiated': def(
    'payments',
    z.object({
      paymentId: id,
      type: z.string(),
      method: z.string(),
      amountMinor: minor,
      currency,
      memberId: id,
    }),
  ),
  'payment.processing': def('payments', z.object({ paymentId: id, provider: z.string() })),
  'payment.completed': def(
    'payments',
    z.object({
      paymentId: id,
      type: z.string(),
      memberId: id,
      amountMinor: minor,
      currency,
      transactionId: nullableId,
    }),
  ),
  'payment.failed': def(
    'payments',
    z.object({ paymentId: id, type: z.string(), memberId: id, reason: z.string() }),
  ),
  'payment.expired': def('payments', z.object({ paymentId: id, type: z.string(), memberId: id })),
  'payment.refunded': def(
    'payments',
    z.object({ paymentId: id, refundPaymentId: id, memberId: id, amountMinor: minor, currency }),
  ),

  // --- compliance ---
  'compliance.rule.updated': def(
    'compliance',
    z.object({
      ruleCode: z.string(),
      country: z.string(),
      version: z.number().int(),
      change: z.string(),
    }),
  ),
  'compliance.violation.detected': def(
    'compliance',
    z.object({
      violationId: id,
      memberId: id,
      operationType: z.string(),
      ruleCode: z.string(),
      action: z.string(),
    }),
  ),
  'compliance.user.restricted': def('compliance', z.object({ memberId: id, reason: z.string() })),
  'compliance.user.suspended': def('compliance', z.object({ memberId: id, reason: z.string() })),

  // --- fraude (A-14) ---
  'fraud.user.flagged': def(
    'administration',
    z.object({ memberId: id, reason: z.string(), flaggedBy: z.string() }),
  ),

  // --- notifications ---
  'notification.created': def(
    'notifications',
    z.object({
      notificationId: id,
      memberId: id,
      type: z.string(),
      channel: z.string(),
      priority: z.string(),
    }),
  ),
  'notification.sent': def(
    'notifications',
    z.object({ notificationId: id, channel: z.string(), attempts: z.number().int() }),
  ),
  'notification.failed': def(
    'notifications',
    z.object({
      notificationId: id,
      channel: z.string(),
      attempts: z.number().int(),
      dead: z.boolean(),
    }),
  ),

  // --- administration ---
  'admin.message.sent': def(
    'administration',
    z.object({ messageId: id, tontineId: id, recipientCount: z.number().int() }),
  ),
  'report.generated': def(
    'administration',
    z.object({ reportId: z.string(), tontineId: nullableId, kind: z.string() }),
  ),
} as const;

export type EventCatalog = typeof EVENT_CATALOG;
export type EventType = keyof EventCatalog;
export type EventPayload<T extends EventType> = z.infer<EventCatalog[T]['payload']>;
export const EVENT_TYPES = Object.keys(EVENT_CATALOG) as EventType[];

export function isEventType(value: string): value is EventType {
  return Object.prototype.hasOwnProperty.call(EVENT_CATALOG, value);
}
