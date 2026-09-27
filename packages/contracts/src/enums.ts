/**
 * Énumérations partagées API ⇄ web ⇄ base de données.
 * Toute modification doit être répercutée dans `packages/database/prisma/schema.prisma`
 * (un test de cohérence le vérifie).
 */

function values<const T extends readonly string[]>(...v: T): T {
  return v;
}

export const PLATFORM_ROLES = values('SUPER_ADMIN', 'TONTINE_ADMIN', 'MEMBER', 'KYC_AGENT');
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const USER_STATUSES = values(
  'PENDING_APPROVAL',
  'PENDING_ACTIVATION',
  'ACTIVE',
  'SUSPENDED',
  'REJECTED',
  'EXPIRED',
  'INACTIVE',
);
export type UserStatus = (typeof USER_STATUSES)[number];

export const COMMUNICATION_CHANNELS = values('SMS', 'EMAIL');
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

export const MFA_TYPES = values('TOTP', 'SMS');
export type MfaType = (typeof MFA_TYPES)[number];

export const MEMBER_STATUSES = values(
  'PENDING',
  'KYC_REQUIRED',
  'KYC_IN_REVIEW',
  'KYC_REJECTED',
  'ACTIVE',
  'SUSPENDED',
  'PENDING_REVIEW',
);
export type MemberStatus = (typeof MEMBER_STATUSES)[number];

export const KYC_LEVELS = values('NONE', 'TIER_1', 'TIER_2', 'TIER_3');
export type KycLevel = (typeof KYC_LEVELS)[number];

export const COMPLIANCE_STATUSES = values(
  'COMPLIANT',
  'RESTRICTED',
  'UNDER_REVIEW',
  'NON_COMPLIANT',
  'SUSPENDED',
);
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

export const GENDERS = values('M', 'F', 'OTHER', 'UNDISCLOSED');
export type Gender = (typeof GENDERS)[number];

export const KYC_REQUEST_STATUSES = values(
  'SUBMITTED',
  'PROCESSING',
  'VERIFIED',
  'REVIEW_REQUIRED',
  'REJECTED',
  'EXPIRED',
  'SUPPLEMENT_REQUESTED',
);
export type KycRequestStatus = (typeof KYC_REQUEST_STATUSES)[number];

export const KYC_DOCUMENT_TYPES = values(
  'CNI',
  'PASSPORT',
  'DRIVING_LICENSE',
  'NIN_SLIP',
  'VOTER_CARD',
  'RESIDENCE_PERMIT',
  'PROOF_OF_ADDRESS',
  'INCOME_DECLARATION',
);
export type KycDocumentType = (typeof KYC_DOCUMENT_TYPES)[number];

export const KYC_FILE_KINDS = values(
  'ID_FRONT',
  'ID_BACK',
  'SELFIE',
  'PROOF_OF_ADDRESS',
  'INCOME_DECLARATION',
);
export type KycFileKind = (typeof KYC_FILE_KINDS)[number];

export const KYC_CHECK_STEPS = values(
  'QUALITY',
  'OCR',
  'DOCUMENT_VALIDATION',
  'FACE_MATCH',
  'DUPLICATE',
  'AML',
);
export type KycCheckStep = (typeof KYC_CHECK_STEPS)[number];

export const KYC_CHECK_OUTCOMES = values('PASS', 'REVIEW', 'FAIL', 'ERROR');
export type KycCheckOutcome = (typeof KYC_CHECK_OUTCOMES)[number];

export const KYC_REJECT_CATEGORIES = values(
  'DOCUMENT_ILLISIBLE',
  'DOCUMENT_EXPIRE',
  'DOCUMENT_FALSIFIE',
  'FACE_MATCH_ECHOUE',
  'DOUBLON_CONFIRME',
  'AML_MATCH_CONFIRME',
  'INFORMATION_INCOHERENTE',
  'TYPE_DOCUMENT_NON_ACCEPTE',
  'AUTRE',
);
export type KycRejectCategory = (typeof KYC_REJECT_CATEGORIES)[number];

export const TONTINE_TYPES = values('SIMPLE_ROTATIVE');
export type TontineType = (typeof TONTINE_TYPES)[number];

export const TONTINE_STATUSES = values(
  'DRAFT',
  'READY',
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'CANCELLED',
);
export type TontineStatus = (typeof TONTINE_STATUSES)[number];

export const TONTINE_FREQUENCIES = values('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY');
export type TontineFrequency = (typeof TONTINE_FREQUENCIES)[number];

export const DRAW_MODES = values('RANDOM', 'FIXED_ORDER', 'PRIORITY_NEED');
export type DrawMode = (typeof DRAW_MODES)[number];

export const INCOMPLETE_POLICIES = values('POSTPONE', 'PARTIAL_PAYOUT');
export type IncompletePolicy = (typeof INCOMPLETE_POLICIES)[number];

export const TONTINE_MEMBER_ROLES = values('ADMIN', 'MEMBER');
export type TontineMemberRole = (typeof TONTINE_MEMBER_ROLES)[number];

export const TONTINE_MEMBER_STATUSES = values(
  'PENDING_ACTIVATION',
  'PENDING_APPROVAL',
  'ACTIVE',
  'SUSPENDED',
  'REMOVED',
  'REJECTED',
);
export type TontineMemberStatus = (typeof TONTINE_MEMBER_STATUSES)[number];

export const INVITATION_CHANNELS = values('EMAIL', 'PHONE', 'LINK');
export type InvitationChannel = (typeof INVITATION_CHANNELS)[number];

export const INVITATION_STATUSES = values('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED');
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export const CYCLE_STATUSES = values('PENDING', 'IN_PROGRESS', 'PAYOUT_PENDING', 'COMPLETED');
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

export const CONTRIBUTION_STATUSES = values('PENDING', 'PAID', 'LATE', 'PAID_LATE', 'DEFAULTED');
export type ContributionStatus = (typeof CONTRIBUTION_STATUSES)[number];

export const WALLET_OWNER_TYPES = values('MEMBER', 'TONTINE_POOL', 'TONTINE_RESERVE', 'SYSTEM');
export type WalletOwnerType = (typeof WALLET_OWNER_TYPES)[number];

export const WALLET_STATUSES = values('ACTIVE', 'SUSPENDED', 'LOCKED', 'CLOSED');
export type WalletStatus = (typeof WALLET_STATUSES)[number];

export const MOVEMENT_TYPES = values('CREDIT', 'DEBIT', 'HOLD', 'RELEASE');
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_CONTEXTS = values(
  'DEPOSIT',
  'WITHDRAWAL',
  'TRANSFER',
  'TONTINE_CONTRIBUTION',
  'TONTINE_PAYOUT',
  'PENALTY',
  'ENTRY_FEE',
  'COLLATION',
  'REFUND',
  'REVERSAL',
);
export type MovementContext = (typeof MOVEMENT_CONTEXTS)[number];

export const HOLD_STATUSES = values('ACTIVE', 'CAPTURED', 'RELEASED', 'EXPIRED');
export type HoldStatus = (typeof HOLD_STATUSES)[number];

export const TRANSACTION_TYPES = values(
  'DEPOSIT',
  'WITHDRAWAL',
  'TRANSFER',
  'CONTRIBUTION',
  'PAYOUT',
  'PENALTY',
  'ENTRY_FEE',
  'COLLATION',
  'REFUND',
  'REVERSAL',
);
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_STATUSES = values(
  'PENDING',
  'VALIDATED',
  'COMPLETED',
  'FAILED',
  'REJECTED',
  'REVERSED',
  'REFUNDED',
);
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const TRANSACTION_CONTEXT_TYPES = values('TONTINE', 'PAYMENT', 'WALLET', 'ADMIN');
export type TransactionContextType = (typeof TRANSACTION_CONTEXT_TYPES)[number];

export const PAYMENT_TYPES = values('DEPOSIT', 'WITHDRAWAL', 'REFUND');
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const PAYMENT_METHODS = values('MOBILE_MONEY', 'CARD');
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = values(
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
  'REFUNDED',
);
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const NOTIFICATION_PRIORITIES = values('LOW', 'MEDIUM', 'HIGH', 'URGENT');
export type NotificationPriority = (typeof NOTIFICATION_PRIORITIES)[number];

export const NOTIFICATION_CHANNELS = values('SMS', 'EMAIL', 'PUSH', 'IN_APP');
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_CATEGORIES = values(
  'SECURITY',
  'ACCOUNT',
  'TONTINE',
  'PAYMENT',
  'WALLET',
  'KYC',
  'ADMIN',
  'MESSAGE',
);
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_STATUSES = values(
  'SCHEDULED',
  'PENDING',
  'SENT',
  'FAILED',
  'DEAD',
  'CANCELLED',
  'SKIPPED',
);
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const OPERATION_TYPES = values(
  'DEPOSIT',
  'WITHDRAWAL',
  'TRANSFER',
  'TONTINE_CONTRIBUTION',
  'TONTINE_PAYOUT',
  'TONTINE_CREATION',
  'TONTINE_JOIN',
);
export type OperationType = (typeof OPERATION_TYPES)[number];

export const COMPLIANCE_RULE_TYPES = values(
  'DAILY_LIMIT',
  'MONTHLY_LIMIT',
  'WALLET_LIMIT',
  'KYC_MIN_LEVEL',
  'TONTINE_ALLOWED',
  'OPERATION_FORBIDDEN',
);
export type ComplianceRuleType = (typeof COMPLIANCE_RULE_TYPES)[number];

export const VIOLATION_ACTIONS = values('BLOCKED', 'SUSPENDED', 'ALERTED');
export type ViolationAction = (typeof VIOLATION_ACTIONS)[number];

export const ACCESS_REQUEST_STATUSES = values('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');
export type AccessRequestStatus = (typeof ACCESS_REQUEST_STATUSES)[number];

export const TONTINE_ACCOUNT_TYPES = values('MAIN', 'SOLIDARITY', 'SAVINGS', 'LOAN');
export type TontineAccountType = (typeof TONTINE_ACCOUNT_TYPES)[number];

export const MESSAGE_TEMPLATES = values('REMINDER', 'ANNOUNCEMENT', 'INFORMATION', 'CUSTOM');
export type MessageTemplate = (typeof MESSAGE_TEMPLATES)[number];

export const AUDIT_RESULTS = values('SUCCESS', 'DENIED', 'FAILURE');
export type AuditResult = (typeof AUDIT_RESULTS)[number];
