/**
 * Types des réponses de l'API (cf. docs/api-routes.md). Les schémas d'entrée sont ceux de
 * `@tontine/contracts` ; seules les formes de sortie sont décrites ici.
 */
import type {
  AccessRequestStatus,
  ContributionStatus,
  DrawMode,
  IncompletePolicy,
  InvitationChannel,
  InvitationStatus,
  KycLevel,
  KycRequestStatus,
  MemberStatus,
  MoneyView,
  MovementContext,
  MovementType,
  NotificationCategory,
  NotificationPriority,
  NotificationPrefs,
  PaymentMethod,
  PaymentStatus,
  PlatformRole,
  TontineFrequency,
  TontineMemberRole,
  TontineMemberStatus,
  TontineStatus,
  UserStatus,
} from '@tontine/contracts';

export type { MoneyView };

export interface PageInfo {
  nextCursor: string | null;
  limit: number;
}

export interface ListResponse<T, M = Record<string, unknown>> {
  data: T[];
  page?: PageInfo;
  meta?: M;
}

// --- Authentification ---------------------------------------------------------------

export type AccessState = UserStatus | 'ACTIVE_PENDING_KYC';

export interface Me {
  id: string;
  role: PlatformRole;
  status: UserStatus;
  accessState: AccessState;
  memberStatus: MemberStatus | null;
  kycLevel: KycLevel;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  language: string;
  mfa: {
    enabled: boolean;
    type: 'TOTP' | 'SMS' | null;
    required: boolean;
    usedThisSession: boolean;
  };
  tontineIds: string[];
  delegatedTontine: string | null;
}

export interface LoginTokens {
  accessToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
  user: { id: string; role: PlatformRole; mfaSetupRequired?: boolean };
  recoveryCodesExhausted?: boolean;
}

export interface MfaChallenge {
  mfaRequired: true;
  challengeToken: string;
  mfaType: 'TOTP' | 'SMS';
  expiresIn: number;
}

export type LoginResponse = LoginTokens | MfaChallenge;

export interface SessionView {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export interface MfaStatus {
  enabled: boolean;
  type: 'TOTP' | 'SMS' | null;
  recoveryCodesLeft: number;
  required: boolean;
  mustRegenerate: boolean;
}

export interface MfaEnableTotp {
  type?: 'TOTP';
  otpauthUrl: string;
  qrCodeUrl: string;
  secret: string;
}

export interface MfaEnableSms {
  type?: 'SMS';
  smsSent: boolean;
}

// --- Membres ------------------------------------------------------------------------

export interface MemberView {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  country: string | null;
  countrySource: string | null;
  region: string | null;
  city: string | null;
  address: string | null;
  dateOfBirth: string | null;
  gender: 'M' | 'F' | 'OTHER' | 'UNDISCLOSED' | null;
  language: string | null;
  timezone: string | null;
  status: MemberStatus;
  kycLevel: KycLevel;
  complianceStatus: string;
  notificationPrefs: Partial<NotificationPrefs> | null;
  hasPhoto: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface MemberRow {
  id: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  email: string | null;
  phone: string | null;
  status: MemberStatus;
  kycLevel: KycLevel;
  membershipStatus: TontineMemberStatus;
  membershipRole: TontineMemberRole;
  registeredAt: string;
  joinedAt?: string;
  lastActivityAt: string | null;
}

export interface MembersMeta {
  total: number;
  active: number;
  pending: number;
  suspended: number;
  summary: string;
}

export interface AccessRequestView {
  id: string;
  status: AccessRequestStatus;
  createdAt: string;
  expiresAt: string;
  requestedTontineName: string | null;
  targetTontine: { id: string; name: string | null } | null;
  decisionReason?: string | null;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    [k: string]: unknown;
  };
}

export interface AdminUserView {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  role: PlatformRole;
  status: UserStatus;
  locked: boolean;
  mfaEnabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

// --- Notifications ------------------------------------------------------------------

export interface NotificationView {
  id: string;
  category: NotificationCategory;
  priority: NotificationPriority;
  title: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

export interface DevMessage {
  id: string;
  channel: 'SMS' | 'EMAIL';
  to: string;
  toMasked: string | null;
  subject: string | null;
  body: string;
  status: string;
  createdAt: string;
}

// --- Portefeuille -------------------------------------------------------------------

export interface WalletView {
  id: string;
  currency: string;
  status: string;
  balance: MoneyView;
  available: MoneyView;
  blocked: MoneyView;
  updatedAt?: string;
}

export interface MovementView {
  id: string;
  type: MovementType;
  direction: 'IN' | 'OUT' | 'NEUTRAL';
  amount: MoneyView;
  balanceAfter: MoneyView;
  availableAfter?: MoneyView;
  context: MovementContext;
  contextLabel: string | null;
  contextRef: string | null;
  transactionId: string | null;
  description: string | null;
  createdAt: string;
}

export interface PaymentView {
  id: string;
  type: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: MoneyView;
  provider?: string;
  reference?: string;
  providerReference?: string;
  redirectUrl?: string | null;
  createdAt: string;
}

export interface TransactionView {
  id: string;
  type: string;
  status: string;
  amount: MoneyView;
  createdAt: string;
  [k: string]: unknown;
}

// --- KYC ----------------------------------------------------------------------------

export interface KycRequirements {
  country: string;
  documentTypes: string[];
  singleSided: string[];
  maxFileBytes: number;
  minWidth: number;
  minHeight: number;
}

export interface KycRequestSummary {
  id: string;
  status: KycRequestStatus;
  documentType: string;
  submittedAt: string;
  decidedAt?: string | null;
  rejectCategory?: string | null;
  rejectReason?: string | null;
  kind?: string;
}

export interface KycMe {
  kycLevel: KycLevel;
  memberStatus: MemberStatus;
  current: KycRequestSummary | null;
  history: KycRequestSummary[];
}

export interface KycReviewItem {
  id: string;
  status: KycRequestStatus;
  documentType: string;
  submittedAt: string;
  slaDueAt: string;
  member?: { id: string; firstName?: string; lastName?: string; country?: string | null };
  alerts?: string[];
}

export interface KycCheckView {
  step: string;
  outcome: string;
  score?: number | null;
  details?: unknown;
}

export interface KycDocumentMeta {
  id: string;
  kind: string;
  mimeType?: string;
  width?: number | null;
  height?: number | null;
}

export interface KycRequestDetail extends KycReviewItem {
  documents: KycDocumentMeta[];
  checks: KycCheckView[];
  alerts?: string[];
  previousSubmissions?: KycRequestSummary[];
}

// --- Tontines -----------------------------------------------------------------------

export interface TontineView {
  id: string;
  name: string;
  status: TontineStatus;
  contribution: MoneyView;
  frequency: TontineFrequency;
  frequencyDetail: Record<string, unknown>;
  maxMembers: number;
  memberCount: number;
  startDate: string;
  drawMode: DrawMode;
  penaltyRules: Record<string, number>;
  entryFee: MoneyView | null;
  collation: MoneyView | null;
  incompletePolicy: IncompletePolicy;
  currentCycleNumber: number | null;
  totalCycles: number | null;
  myRole: TontineMemberRole | null;
  myStatus: TontineMemberStatus | null;
  version: number;
}

export interface ParticipantView {
  memberId: string;
  firstName: string;
  role: TontineMemberRole;
  position: number | null;
  currentContributionStatus: ContributionStatus | null;
}

export interface InvitationView {
  id: string;
  channel: InvitationChannel;
  status: InvitationStatus;
  expiresAt: string;
  url?: string | null;
  code?: string | null;
  email?: string | null;
  phone?: string | null;
  createdAt?: string;
  tontine?: {
    id: string;
    name: string;
    contribution?: MoneyView;
    frequency?: string;
    startDate?: string;
  };
}

export interface ContributionView {
  id: string;
  memberId?: string;
  memberName?: string;
  cycleNumber?: number;
  status: ContributionStatus;
  amount: MoneyView;
  penalty?: MoneyView | null;
  dueDate?: string;
  paidAt?: string | null;
  tontineId?: string;
  tontineName?: string;
}

export interface CycleView {
  id: string;
  number: number;
  status: string;
  dueDate?: string;
  beneficiary?: { memberId: string; firstName?: string; fullName?: string } | null;
  collected?: MoneyView;
  expected?: MoneyView;
  contributions?: ContributionView[];
}

export interface AdminTontineDashboard {
  totalCollected: MoneyView;
  currentCycle: {
    number: number;
    beneficiary: { memberId?: string; firstName?: string; fullName?: string } | string | null;
    paidCount: number;
    memberCount: number;
    collected: MoneyView;
    remaining: MoneyView;
    dueDate: string;
  } | null;
  cycles: CycleView[];
  penaltiesCollected: MoneyView;
  lateMembers: Array<{
    memberId: string;
    fullName?: string;
    firstName?: string;
    daysLate?: number;
  }>;
}

export interface MemberTontineDashboard {
  myContributions: ContributionView[];
  myBeneficiaryCycles: Array<{ number: number; dueDate?: string; status?: string }>;
  myPenaltyBalance: MoneyView;
}

export interface TontineAccountView {
  id: string;
  name: string;
  type: 'MAIN' | 'SOLIDARITY' | 'SAVINGS' | 'LOAN';
  balance?: MoneyView;
  rules?: Record<string, unknown>;
}

export interface TargetedMessageView {
  id: string;
  template: string;
  subject: string;
  body: string;
  recipientCount?: number;
  createdAt: string;
}

export interface PriorityRequestView {
  id: string;
  memberId: string;
  firstName?: string;
  reason: string;
  status: string;
  createdAt: string;
}

// --- Exploitation / conformité ------------------------------------------------------

export interface JobView {
  name: string;
  cron: string;
  description?: string;
}

export interface DeadEventView {
  id: string;
  eventType: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

export interface AuditLogView {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  result: 'SUCCESS' | 'DENIED' | 'FAILURE';
  ip: string | null;
  correlationId: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface ComplianceRuleView {
  code: string;
  countryCode: string;
  ruleType: string;
  operationTypes: string[];
  params: Record<string, unknown>;
  active: boolean;
  description?: string | null;
  version?: number;
  updatedAt?: string;
}
