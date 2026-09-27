import * as C from '@tontine/contracts';
import { describe, expect, it } from 'vitest';
import * as P from './generated/enums';

/** Les énumérations Prisma et celles des contrats partagés doivent rester identiques. */
const PAIRS: Array<[string, Record<string, string>, readonly string[]]> = [
  ['PlatformRole', P.PlatformRole, C.PLATFORM_ROLES],
  ['UserStatus', P.UserStatus, C.USER_STATUSES],
  ['MemberStatus', P.MemberStatus, C.MEMBER_STATUSES],
  ['KycLevel', P.KycLevel, C.KYC_LEVELS],
  ['ComplianceStatus', P.ComplianceStatus, C.COMPLIANCE_STATUSES],
  ['Gender', P.Gender, C.GENDERS],
  ['KycRequestStatus', P.KycRequestStatus, C.KYC_REQUEST_STATUSES],
  ['KycDocumentType', P.KycDocumentType, C.KYC_DOCUMENT_TYPES],
  ['KycFileKind', P.KycFileKind, C.KYC_FILE_KINDS],
  ['KycCheckStep', P.KycCheckStep, C.KYC_CHECK_STEPS],
  ['KycCheckOutcome', P.KycCheckOutcome, C.KYC_CHECK_OUTCOMES],
  ['KycRejectCategory', P.KycRejectCategory, C.KYC_REJECT_CATEGORIES],
  ['TontineStatus', P.TontineStatus, C.TONTINE_STATUSES],
  ['TontineFrequency', P.TontineFrequency, C.TONTINE_FREQUENCIES],
  ['DrawMode', P.DrawMode, C.DRAW_MODES],
  ['IncompletePolicy', P.IncompletePolicy, C.INCOMPLETE_POLICIES],
  ['TontineMemberStatus', P.TontineMemberStatus, C.TONTINE_MEMBER_STATUSES],
  ['InvitationStatus', P.InvitationStatus, C.INVITATION_STATUSES],
  ['CycleStatus', P.CycleStatus, C.CYCLE_STATUSES],
  ['ContributionStatus', P.ContributionStatus, C.CONTRIBUTION_STATUSES],
  ['WalletOwnerType', P.WalletOwnerType, C.WALLET_OWNER_TYPES],
  ['WalletStatus', P.WalletStatus, C.WALLET_STATUSES],
  ['MovementType', P.MovementType, C.MOVEMENT_TYPES],
  ['MovementContext', P.MovementContext, C.MOVEMENT_CONTEXTS],
  ['HoldStatus', P.HoldStatus, C.HOLD_STATUSES],
  ['TransactionType', P.TransactionType, C.TRANSACTION_TYPES],
  ['TransactionStatus', P.TransactionStatus, C.TRANSACTION_STATUSES],
  ['PaymentStatus', P.PaymentStatus, C.PAYMENT_STATUSES],
  ['PaymentMethod', P.PaymentMethod, C.PAYMENT_METHODS],
  ['NotificationChannel', P.NotificationChannel, C.NOTIFICATION_CHANNELS],
  ['NotificationCategory', P.NotificationCategory, C.NOTIFICATION_CATEGORIES],
  ['NotificationStatus', P.NotificationStatus, C.NOTIFICATION_STATUSES],
  ['OperationType', P.OperationType, C.OPERATION_TYPES],
  ['ComplianceRuleType', P.ComplianceRuleType, C.COMPLIANCE_RULE_TYPES],
  ['TontineAccountType', P.TontineAccountType, C.TONTINE_ACCOUNT_TYPES],
  ['MessageTemplate', P.MessageTemplate, C.MESSAGE_TEMPLATES],
  ['AuditResult', P.AuditResult, C.AUDIT_RESULTS],
];

describe('Cohérence des énumérations Prisma ⇄ contrats', () => {
  it.each(PAIRS)('%s', (_name, prismaEnum, contractValues) => {
    expect(Object.values(prismaEnum).sort()).toEqual([...contractValues].sort());
  });
});
