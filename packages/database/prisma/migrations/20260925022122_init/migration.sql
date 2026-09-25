-- Extensions requises (citext : emails insensibles à la casse ; pg_trgm : recherche partielle US-2.3)
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('SUPER_ADMIN', 'TONTINE_ADMIN', 'MEMBER', 'KYC_AGENT');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_APPROVAL', 'PENDING_ACTIVATION', 'ACTIVE', 'SUSPENDED', 'REJECTED', 'EXPIRED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CommunicationChannel" AS ENUM ('SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "MfaType" AS ENUM ('TOTP', 'SMS');

-- CreateEnum
CREATE TYPE "AuthTokenType" AS ENUM ('ACTIVATION_LINK', 'ACTIVATION_OTP', 'PASSWORD_RESET', 'MFA_CHALLENGE', 'MFA_SMS_LOGIN', 'MFA_SETUP_SMS');

-- CreateEnum
CREATE TYPE "AccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('PENDING', 'KYC_REQUIRED', 'KYC_IN_REVIEW', 'KYC_REJECTED', 'ACTIVE', 'SUSPENDED', 'PENDING_REVIEW');

-- CreateEnum
CREATE TYPE "KycLevel" AS ENUM ('NONE', 'TIER_1', 'TIER_2', 'TIER_3');

-- CreateEnum
CREATE TYPE "ComplianceStatus" AS ENUM ('COMPLIANT', 'RESTRICTED', 'UNDER_REVIEW', 'NON_COMPLIANT', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('M', 'F', 'OTHER', 'UNDISCLOSED');

-- CreateEnum
CREATE TYPE "MemberAuditAction" AS ENUM ('CREATED', 'UPDATED', 'STATUS_CHANGED', 'KYC_LEVEL_CHANGED', 'SUSPENDED', 'REACTIVATED', 'ACCESS_DENIED', 'INVALID_TRANSITION');

-- CreateEnum
CREATE TYPE "ActorRole" AS ENUM ('SYSTEM', 'MEMBER', 'ADMIN', 'SUPER_ADMIN', 'KYC_AGENT');

-- CreateEnum
CREATE TYPE "KycRequestStatus" AS ENUM ('SUBMITTED', 'PROCESSING', 'VERIFIED', 'REVIEW_REQUIRED', 'REJECTED', 'EXPIRED', 'SUPPLEMENT_REQUESTED');

-- CreateEnum
CREATE TYPE "KycDocumentType" AS ENUM ('CNI', 'PASSPORT', 'DRIVING_LICENSE', 'NIN_SLIP', 'VOTER_CARD', 'RESIDENCE_PERMIT', 'PROOF_OF_ADDRESS', 'INCOME_DECLARATION');

-- CreateEnum
CREATE TYPE "KycFileKind" AS ENUM ('ID_FRONT', 'ID_BACK', 'SELFIE', 'PROOF_OF_ADDRESS', 'INCOME_DECLARATION');

-- CreateEnum
CREATE TYPE "KycCheckStep" AS ENUM ('QUALITY', 'OCR', 'DOCUMENT_VALIDATION', 'FACE_MATCH', 'DUPLICATE', 'AML');

-- CreateEnum
CREATE TYPE "KycCheckOutcome" AS ENUM ('PASS', 'REVIEW', 'FAIL', 'ERROR');

-- CreateEnum
CREATE TYPE "KycRejectCategory" AS ENUM ('DOCUMENT_ILLISIBLE', 'DOCUMENT_EXPIRE', 'DOCUMENT_FALSIFIE', 'FACE_MATCH_ECHOUE', 'DOUBLON_CONFIRME', 'AML_MATCH_CONFIRME', 'INFORMATION_INCOHERENTE', 'TYPE_DOCUMENT_NON_ACCEPTE', 'AUTRE');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'CONFIRMED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "TontineType" AS ENUM ('SIMPLE_ROTATIVE');

-- CreateEnum
CREATE TYPE "TontineStatus" AS ENUM ('DRAFT', 'READY', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TontineFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY', 'BIMONTHLY');

-- CreateEnum
CREATE TYPE "DrawMode" AS ENUM ('RANDOM', 'FIXED_ORDER', 'PRIORITY_NEED');

-- CreateEnum
CREATE TYPE "IncompletePolicy" AS ENUM ('POSTPONE', 'PARTIAL_PAYOUT');

-- CreateEnum
CREATE TYPE "TontineMemberRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "TontineMemberStatus" AS ENUM ('PENDING_ACTIVATION', 'PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED', 'REMOVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "InvitationChannel" AS ENUM ('EMAIL', 'PHONE', 'LINK');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CycleStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'PAYOUT_PENDING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ContributionStatus" AS ENUM ('PENDING', 'PAID', 'LATE', 'PAID_LATE', 'DEFAULTED');

-- CreateEnum
CREATE TYPE "PriorityRequestStatus" AS ENUM ('PENDING', 'SELECTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "WalletOwnerType" AS ENUM ('MEMBER', 'TONTINE_POOL', 'TONTINE_RESERVE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "WalletStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'LOCKED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('CREDIT', 'DEBIT', 'HOLD', 'RELEASE');

-- CreateEnum
CREATE TYPE "MovementContext" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'TONTINE_CONTRIBUTION', 'TONTINE_PAYOUT', 'PENALTY', 'ENTRY_FEE', 'COLLATION', 'REFUND', 'REVERSAL');

-- CreateEnum
CREATE TYPE "HoldStatus" AS ENUM ('ACTIVE', 'CAPTURED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'CONTRIBUTION', 'PAYOUT', 'PENALTY', 'ENTRY_FEE', 'COLLATION', 'REFUND', 'REVERSAL');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'VALIDATED', 'COMPLETED', 'FAILED', 'REJECTED', 'REVERSED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "TransactionContextType" AS ENUM ('TONTINE', 'PAYMENT', 'WALLET', 'ADMIN');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'REFUND');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('MOBILE_MONEY', 'CARD');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('SMS', 'EMAIL', 'PUSH', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('SECURITY', 'ACCOUNT', 'TONTINE', 'PAYMENT', 'WALLET', 'KYC', 'ADMIN', 'MESSAGE');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('SCHEDULED', 'PENDING', 'SENT', 'FAILED', 'DEAD', 'CANCELLED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "OperationType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'TONTINE_CONTRIBUTION', 'TONTINE_PAYOUT', 'TONTINE_CREATION', 'TONTINE_JOIN');

-- CreateEnum
CREATE TYPE "ComplianceRuleType" AS ENUM ('DAILY_LIMIT', 'MONTHLY_LIMIT', 'WALLET_LIMIT', 'KYC_MIN_LEVEL', 'TONTINE_ALLOWED', 'OPERATION_FORBIDDEN');

-- CreateEnum
CREATE TYPE "ViolationAction" AS ENUM ('BLOCKED', 'SUSPENDED', 'ALERTED');

-- CreateEnum
CREATE TYPE "TontineAccountType" AS ENUM ('MAIN', 'SOLIDARITY', 'SAVINGS', 'LOAN');

-- CreateEnum
CREATE TYPE "MessageTemplate" AS ENUM ('REMINDER', 'ANNOUNCEMENT', 'INFORMATION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('SUCCESS', 'DENIED', 'FAILURE');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'DEAD');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ReconciliationKind" AS ENUM ('INTERNAL', 'PSP');

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "eventVersion" INTEGER NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "producer" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "causationId" TEXT,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "publishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seq" BIGSERIAL NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_events" (
    "consumer" TEXT NOT NULL,
    "eventId" UUID NOT NULL,
    "processedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("consumer","eventId")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT,
    "result" "AuditResult" NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "country" TEXT,
    "correlationId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),
    "status" TEXT NOT NULL,
    "summary" JSONB,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_users" (
    "id" UUID NOT NULL,
    "email" CITEXT,
    "phone" TEXT,
    "passwordHash" TEXT,
    "role" "PlatformRole" NOT NULL DEFAULT 'MEMBER',
    "status" "UserStatus" NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "countryCode" CHAR(2),
    "language" TEXT,
    "preferredChannel" "CommunicationChannel",
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaType" "MfaType",
    "mfaSecretEnc" TEXT,
    "mfaPendingSecretEnc" TEXT,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "lockReason" TEXT,
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdById" UUID,
    "delegatedTontineName" TEXT,
    "delegatedTontineUsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "auth_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_password_history" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_password_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "AuthTokenType" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_refresh_sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "deviceFingerprint" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "mfaUsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "rotatedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "revokedReason" TEXT,
    "replacedById" UUID,

    CONSTRAINT "auth_refresh_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_login_attempts" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "identifierHash" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_recovery_codes" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_known_devices" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_known_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_access_requests" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "invitationCodeHash" TEXT,
    "requestedTontineName" TEXT,
    "targetTontineId" UUID,
    "ipHash" TEXT,
    "status" "AccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decisionReason" TEXT,
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mbr_members" (
    "id" UUID NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" CITEXT,
    "phone" TEXT,
    "countryCode" CHAR(2),
    "countrySource" TEXT,
    "region" TEXT,
    "city" TEXT,
    "address" TEXT,
    "dateOfBirth" DATE,
    "gender" "Gender",
    "language" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "MemberStatus" NOT NULL DEFAULT 'PENDING',
    "kycLevel" "KycLevel" NOT NULL DEFAULT 'NONE',
    "complianceStatus" "ComplianceStatus" NOT NULL DEFAULT 'COMPLIANT',
    "profilePhotoRef" TEXT,
    "notificationPrefs" JSONB NOT NULL,
    "metadata" JSONB,
    "lastActivityAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "mbr_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mbr_audit_logs" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "action" "MemberAuditAction" NOT NULL,
    "changedBy" UUID,
    "changedByRole" "ActorRole" NOT NULL,
    "trigger" TEXT,
    "oldValues" JSONB,
    "newValues" JSONB,
    "ipAddress" TEXT,
    "deviceInfo" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mbr_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_requests" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "targetLevel" "KycLevel" NOT NULL,
    "status" "KycRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "documentType" "KycDocumentType" NOT NULL,
    "documentCountry" CHAR(2),
    "documentNumberHash" TEXT,
    "documentExpiresAt" DATE,
    "extracted" JSONB,
    "livenessToken" TEXT,
    "incomeSource" TEXT,
    "rejectCategory" "KycRejectCategory",
    "rejectReason" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMPTZ(3),
    "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),
    "slaDueAt" TIMESTAMPTZ(3),
    "expiryWarnings" JSONB,
    "retentionUntil" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "kyc_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_documents" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "kind" "KycFileKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_checks" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "step" "KycCheckStep" NOT NULL,
    "outcome" "KycCheckOutcome" NOT NULL,
    "score" DOUBLE PRECISION,
    "details" JSONB,
    "durationMs" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_agent_actions" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "agentId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "category" "KycRejectCategory",
    "comment" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_agent_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_biometric_templates" (
    "memberId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "template" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_biometric_templates_pkey" PRIMARY KEY ("memberId")
);

-- CreateTable
CREATE TABLE "kyc_duplicate_alerts" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "duplicateOfMemberId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "similarityScore" DOUBLE PRECISION NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedBy" UUID,
    "resolutionComment" TEXT,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_duplicate_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_aml_matches" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "requestId" UUID,
    "listName" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "entryName" TEXT NOT NULL,
    "entryCountry" TEXT,
    "entryReason" TEXT,
    "entryAddedAt" DATE,
    "score" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedBy" UUID,
    "resolutionComment" TEXT,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_aml_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_aml_whitelist" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "listName" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "confirmedBy" UUID NOT NULL,
    "comment" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_aml_whitelist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ton_tontines" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TontineType" NOT NULL DEFAULT 'SIMPLE_ROTATIVE',
    "status" "TontineStatus" NOT NULL DEFAULT 'DRAFT',
    "contributionMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "frequency" "TontineFrequency" NOT NULL,
    "frequencyDetail" JSONB NOT NULL,
    "maxMembers" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "timezone" TEXT NOT NULL,
    "drawMode" "DrawMode" NOT NULL,
    "graceDays" INTEGER NOT NULL,
    "lateFeeBps" INTEGER NOT NULL,
    "suspendAfter" INTEGER NOT NULL,
    "defaultAfterDays" INTEGER NOT NULL DEFAULT 7,
    "entryFeeMinor" BIGINT NOT NULL DEFAULT 0,
    "collationMinor" BIGINT NOT NULL DEFAULT 0,
    "incompletePolicy" "IncompletePolicy" NOT NULL DEFAULT 'POSTPONE',
    "createdById" UUID NOT NULL,
    "createdByDelegation" BOOLEAN NOT NULL DEFAULT false,
    "invitationLinkHash" TEXT,
    "invitationLinkExpires" TIMESTAMPTZ(3),
    "drawOrder" JSONB,
    "drawProof" TEXT,
    "drawSeedHash" TEXT,
    "drawnAt" TIMESTAMPTZ(3),
    "totalCycles" INTEGER,
    "currentCycleNumber" INTEGER,
    "poolWalletId" UUID,
    "reserveWalletId" UUID,
    "pausedReason" TEXT,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "archivedUntil" TIMESTAMPTZ(3),
    "finalReportRef" TEXT,
    "lastStartCheckAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ton_tontines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ton_members" (
    "id" UUID NOT NULL,
    "tontineId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "role" "TontineMemberRole" NOT NULL DEFAULT 'MEMBER',
    "status" "TontineMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "position" INTEGER,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entryFeePaid" BOOLEAN NOT NULL DEFAULT false,
    "entryFeeTxId" UUID,
    "consecutiveDefaults" INTEGER NOT NULL DEFAULT 0,
    "receivedPayout" BOOLEAN NOT NULL DEFAULT false,
    "registeredById" UUID,
    "decisionReason" TEXT,
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ton_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ton_invitations" (
    "id" UUID NOT NULL,
    "tontineId" UUID NOT NULL,
    "channel" "InvitationChannel" NOT NULL,
    "targetEmail" CITEXT,
    "targetPhone" TEXT,
    "invitedUserId" UUID,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invitedById" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "respondedAt" TIMESTAMPTZ(3),
    "respondedById" UUID,
    "declineReasons" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ton_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ton_cycles" (
    "id" UUID NOT NULL,
    "tontineId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "CycleStatus" NOT NULL DEFAULT 'PENDING',
    "beneficiaryId" UUID,
    "startDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "expectedMinor" BIGINT NOT NULL DEFAULT 0,
    "collectedMinor" BIGINT NOT NULL DEFAULT 0,
    "payoutMinor" BIGINT,
    "payoutTxId" UUID,
    "partialPayout" BOOLEAN NOT NULL DEFAULT false,
    "beneficiaryProof" TEXT,
    "postponedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ton_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ton_contributions" (
    "id" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "tontineId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "penaltyMinor" BIGINT NOT NULL DEFAULT 0,
    "penaltyPaid" BOOLEAN NOT NULL DEFAULT false,
    "penaltyTxId" UUID,
    "status" "ContributionStatus" NOT NULL DEFAULT 'PENDING',
    "dueDate" DATE NOT NULL,
    "graceUntil" DATE NOT NULL,
    "defaultAt" DATE NOT NULL,
    "paidAt" TIMESTAMPTZ(3),
    "transactionId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ton_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ton_priority_requests" (
    "id" UUID NOT NULL,
    "tontineId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "PriorityRequestStatus" NOT NULL DEFAULT 'PENDING',
    "cycleNumber" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ton_priority_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wal_wallets" (
    "id" UUID NOT NULL,
    "ownerType" "WalletOwnerType" NOT NULL,
    "memberId" UUID,
    "tontineId" UUID,
    "systemCode" TEXT,
    "currency" CHAR(3) NOT NULL,
    "balanceMinor" BIGINT NOT NULL DEFAULT 0,
    "blockedMinor" BIGINT NOT NULL DEFAULT 0,
    "allowNegative" BOOLEAN NOT NULL DEFAULT false,
    "status" "WalletStatus" NOT NULL DEFAULT 'ACTIVE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "wal_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wal_movements" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "transactionId" UUID,
    "holdId" UUID,
    "type" "MovementType" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "balanceAfter" BIGINT NOT NULL,
    "availableAfter" BIGINT NOT NULL,
    "context" "MovementContext" NOT NULL,
    "contextRef" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seq" BIGSERIAL NOT NULL,

    CONSTRAINT "wal_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wal_holds" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "context" "MovementContext" NOT NULL,
    "referenceId" TEXT,
    "status" "HoldStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotencyKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wal_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wal_status_history" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "oldStatus" "WalletStatus" NOT NULL,
    "newStatus" "WalletStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wal_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trx_transactions" (
    "id" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "status" "TransactionStatus" NOT NULL DEFAULT 'PENDING',
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "initiatorId" UUID,
    "beneficiaryId" UUID,
    "sourceWalletId" UUID,
    "destinationWalletId" UUID,
    "holdId" UUID,
    "contextType" "TransactionContextType" NOT NULL,
    "contextId" TEXT,
    "description" TEXT,
    "metadata" JSONB NOT NULL,
    "rejectionRule" TEXT,
    "rejectionReason" TEXT,
    "failureCode" TEXT,
    "failureReason" TEXT,
    "reversalOfId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trx_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trx_audit_logs" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "actorId" UUID,
    "ip" TEXT,
    "device" TEXT,
    "userAgent" TEXT,
    "country" TEXT,
    "details" JSONB,
    "retainUntil" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trx_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trx_reconciliation_reports" (
    "id" UUID NOT NULL,
    "kind" "ReconciliationKind" NOT NULL,
    "businessDate" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "checkedCount" INTEGER NOT NULL,
    "discrepancyCount" INTEGER NOT NULL,
    "thresholdMinor" BIGINT NOT NULL DEFAULT 0,
    "alert" BOOLEAN NOT NULL DEFAULT false,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trx_reconciliation_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_payments" (
    "id" UUID NOT NULL,
    "type" "PaymentType" NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amountMinor" BIGINT NOT NULL,
    "feeMinor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "provider" TEXT NOT NULL,
    "providerReference" TEXT,
    "memberId" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "destinationMasked" TEXT,
    "destinationEnc" TEXT,
    "transactionId" UUID,
    "holdId" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "redirectUrl" TEXT,
    "refundOfId" UUID,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "nextPollAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pay_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_status_history" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "fromStatus" "PaymentStatus",
    "toStatus" "PaymentStatus" NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pay_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pay_webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "result" TEXT NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),

    CONSTRAINT "pay_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ntf_templates" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "language" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ntf_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ntf_notifications" (
    "id" UUID NOT NULL,
    "recipientId" UUID NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "templateKey" TEXT NOT NULL,
    "eventId" UUID,
    "eventType" TEXT,
    "priority" "NotificationPriority" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "dedupeKey" TEXT,
    "scheduledFor" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ntf_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ntf_outbound_messages" (
    "id" UUID NOT NULL,
    "notificationId" UUID,
    "channel" "NotificationChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerRef" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ntf_outbound_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cmp_rules" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "ruleType" "ComplianceRuleType" NOT NULL,
    "operationTypes" "OperationType"[],
    "params" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cmp_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cmp_rule_history" (
    "id" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "change" TEXT NOT NULL,
    "reason" TEXT,
    "changedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cmp_rule_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cmp_violations" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "operationType" "OperationType" NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "action" "ViolationAction" NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cmp_violations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adm_tontine_accounts" (
    "id" UUID NOT NULL,
    "tontineId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "TontineAccountType" NOT NULL,
    "rules" JSONB NOT NULL,
    "functional" BOOLEAN NOT NULL DEFAULT false,
    "walletId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adm_tontine_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adm_messages" (
    "id" UUID NOT NULL,
    "tontineId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "template" "MessageTemplate" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "filter" JSONB NOT NULL,
    "recipientCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adm_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbox_events_status_nextAttemptAt_idx" ON "outbox_events"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "outbox_events_aggregateType_aggregateId_idx" ON "outbox_events"("aggregateType", "aggregateId");

-- CreateIndex
CREATE INDEX "outbox_events_eventType_idx" ON "outbox_events"("eventType");

-- CreateIndex
CREATE INDEX "idempotency_keys_expiresAt_idx" ON "idempotency_keys"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_scope_userId_key_key" ON "idempotency_keys"("scope", "userId", "key");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_resourceType_resourceId_idx" ON "audit_logs"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "audit_logs_result_createdAt_idx" ON "audit_logs"("result", "createdAt");

-- CreateIndex
CREATE INDEX "job_runs_name_startedAt_idx" ON "job_runs"("name", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "auth_users_email_key" ON "auth_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "auth_users_phone_key" ON "auth_users"("phone");

-- CreateIndex
CREATE INDEX "auth_users_status_idx" ON "auth_users"("status");

-- CreateIndex
CREATE INDEX "auth_password_history_userId_createdAt_idx" ON "auth_password_history"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "auth_tokens_tokenHash_idx" ON "auth_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "auth_tokens_userId_type_createdAt_idx" ON "auth_tokens"("userId", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "auth_refresh_sessions_tokenHash_key" ON "auth_refresh_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "auth_refresh_sessions_userId_revokedAt_idx" ON "auth_refresh_sessions"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "auth_refresh_sessions_familyId_idx" ON "auth_refresh_sessions"("familyId");

-- CreateIndex
CREATE INDEX "auth_login_attempts_userId_createdAt_idx" ON "auth_login_attempts"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "auth_login_attempts_ip_createdAt_idx" ON "auth_login_attempts"("ip", "createdAt");

-- CreateIndex
CREATE INDEX "auth_recovery_codes_userId_idx" ON "auth_recovery_codes"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "auth_known_devices_userId_fingerprint_key" ON "auth_known_devices"("userId", "fingerprint");

-- CreateIndex
CREATE INDEX "auth_access_requests_status_createdAt_idx" ON "auth_access_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "auth_access_requests_targetTontineId_status_idx" ON "auth_access_requests"("targetTontineId", "status");

-- CreateIndex
CREATE INDEX "mbr_members_status_idx" ON "mbr_members"("status");

-- CreateIndex
CREATE INDEX "mbr_members_kycLevel_idx" ON "mbr_members"("kycLevel");

-- CreateIndex
CREATE INDEX "mbr_audit_logs_memberId_createdAt_idx" ON "mbr_audit_logs"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "kyc_requests_memberId_submittedAt_idx" ON "kyc_requests"("memberId", "submittedAt");

-- CreateIndex
CREATE INDEX "kyc_requests_status_submittedAt_idx" ON "kyc_requests"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "kyc_requests_documentExpiresAt_idx" ON "kyc_requests"("documentExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_documents_storageKey_key" ON "kyc_documents"("storageKey");

-- CreateIndex
CREATE INDEX "kyc_documents_memberId_idx" ON "kyc_documents"("memberId");

-- CreateIndex
CREATE INDEX "kyc_checks_requestId_idx" ON "kyc_checks"("requestId");

-- CreateIndex
CREATE INDEX "kyc_agent_actions_requestId_idx" ON "kyc_agent_actions"("requestId");

-- CreateIndex
CREATE INDEX "kyc_duplicate_alerts_status_createdAt_idx" ON "kyc_duplicate_alerts"("status", "createdAt");

-- CreateIndex
CREATE INDEX "kyc_aml_matches_memberId_listName_entryId_idx" ON "kyc_aml_matches"("memberId", "listName", "entryId");

-- CreateIndex
CREATE INDEX "kyc_aml_matches_status_createdAt_idx" ON "kyc_aml_matches"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "kyc_aml_whitelist_memberId_listName_entryId_key" ON "kyc_aml_whitelist"("memberId", "listName", "entryId");

-- CreateIndex
CREATE INDEX "ton_tontines_status_startDate_idx" ON "ton_tontines"("status", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "ton_tontines_createdById_name_key" ON "ton_tontines"("createdById", "name");

-- CreateIndex
CREATE INDEX "ton_members_memberId_idx" ON "ton_members"("memberId");

-- CreateIndex
CREATE INDEX "ton_members_tontineId_status_idx" ON "ton_members"("tontineId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ton_members_tontineId_memberId_key" ON "ton_members"("tontineId", "memberId");

-- CreateIndex
CREATE INDEX "ton_invitations_tontineId_status_idx" ON "ton_invitations"("tontineId", "status");

-- CreateIndex
CREATE INDEX "ton_invitations_invitedUserId_status_idx" ON "ton_invitations"("invitedUserId", "status");

-- CreateIndex
CREATE INDEX "ton_cycles_status_dueDate_idx" ON "ton_cycles"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "ton_cycles_tontineId_number_key" ON "ton_cycles"("tontineId", "number");

-- CreateIndex
CREATE INDEX "ton_contributions_tontineId_memberId_idx" ON "ton_contributions"("tontineId", "memberId");

-- CreateIndex
CREATE INDEX "ton_contributions_status_graceUntil_idx" ON "ton_contributions"("status", "graceUntil");

-- CreateIndex
CREATE UNIQUE INDEX "ton_contributions_cycleId_memberId_key" ON "ton_contributions"("cycleId", "memberId");

-- CreateIndex
CREATE INDEX "ton_priority_requests_tontineId_status_idx" ON "ton_priority_requests"("tontineId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "wal_wallets_memberId_key" ON "wal_wallets"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "wal_wallets_systemCode_currency_key" ON "wal_wallets"("systemCode", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "wal_wallets_tontineId_ownerType_key" ON "wal_wallets"("tontineId", "ownerType");

-- CreateIndex
CREATE INDEX "wal_movements_walletId_createdAt_idx" ON "wal_movements"("walletId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "wal_movements_transactionId_idx" ON "wal_movements"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "wal_holds_idempotencyKey_key" ON "wal_holds"("idempotencyKey");

-- CreateIndex
CREATE INDEX "wal_holds_status_expiresAt_idx" ON "wal_holds"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "wal_holds_walletId_status_idx" ON "wal_holds"("walletId", "status");

-- CreateIndex
CREATE INDEX "wal_status_history_walletId_createdAt_idx" ON "wal_status_history"("walletId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "trx_transactions_idempotencyKey_key" ON "trx_transactions"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "trx_transactions_reversalOfId_key" ON "trx_transactions"("reversalOfId");

-- CreateIndex
CREATE INDEX "trx_transactions_initiatorId_createdAt_idx" ON "trx_transactions"("initiatorId", "createdAt");

-- CreateIndex
CREATE INDEX "trx_transactions_beneficiaryId_createdAt_idx" ON "trx_transactions"("beneficiaryId", "createdAt");

-- CreateIndex
CREATE INDEX "trx_transactions_contextType_contextId_idx" ON "trx_transactions"("contextType", "contextId");

-- CreateIndex
CREATE INDEX "trx_transactions_status_createdAt_idx" ON "trx_transactions"("status", "createdAt");

-- CreateIndex
CREATE INDEX "trx_audit_logs_transactionId_createdAt_idx" ON "trx_audit_logs"("transactionId", "createdAt");

-- CreateIndex
CREATE INDEX "trx_reconciliation_reports_kind_businessDate_idx" ON "trx_reconciliation_reports"("kind", "businessDate");

-- CreateIndex
CREATE UNIQUE INDEX "pay_payments_providerReference_key" ON "pay_payments"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "pay_payments_idempotencyKey_key" ON "pay_payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "pay_payments_memberId_createdAt_idx" ON "pay_payments"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "pay_payments_status_nextPollAt_idx" ON "pay_payments"("status", "nextPollAt");

-- CreateIndex
CREATE INDEX "pay_status_history_paymentId_createdAt_idx" ON "pay_status_history"("paymentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "pay_webhook_events_provider_providerEventId_key" ON "pay_webhook_events"("provider", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "ntf_templates_key_channel_language_key" ON "ntf_templates"("key", "channel", "language");

-- CreateIndex
CREATE UNIQUE INDEX "ntf_notifications_dedupeKey_key" ON "ntf_notifications"("dedupeKey");

-- CreateIndex
CREATE INDEX "ntf_notifications_recipientId_createdAt_idx" ON "ntf_notifications"("recipientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "ntf_notifications_status_scheduledFor_idx" ON "ntf_notifications"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "ntf_outbound_messages_recipient_createdAt_idx" ON "ntf_outbound_messages"("recipient", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "cmp_rules_code_key" ON "cmp_rules"("code");

-- CreateIndex
CREATE INDEX "cmp_rules_countryCode_active_idx" ON "cmp_rules"("countryCode", "active");

-- CreateIndex
CREATE INDEX "cmp_rule_history_ruleId_version_idx" ON "cmp_rule_history"("ruleId", "version");

-- CreateIndex
CREATE INDEX "cmp_violations_memberId_createdAt_idx" ON "cmp_violations"("memberId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "adm_tontine_accounts_tontineId_type_key" ON "adm_tontine_accounts"("tontineId", "type");

-- CreateIndex
CREATE INDEX "adm_messages_tontineId_createdAt_idx" ON "adm_messages"("tontineId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "auth_password_history" ADD CONSTRAINT "auth_password_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_refresh_sessions" ADD CONSTRAINT "auth_refresh_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_recovery_codes" ADD CONSTRAINT "auth_recovery_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_known_devices" ADD CONSTRAINT "auth_known_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_access_requests" ADD CONSTRAINT "auth_access_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mbr_audit_logs" ADD CONSTRAINT "mbr_audit_logs_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "mbr_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "kyc_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_checks" ADD CONSTRAINT "kyc_checks_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "kyc_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_agent_actions" ADD CONSTRAINT "kyc_agent_actions_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "kyc_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ton_members" ADD CONSTRAINT "ton_members_tontineId_fkey" FOREIGN KEY ("tontineId") REFERENCES "ton_tontines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ton_invitations" ADD CONSTRAINT "ton_invitations_tontineId_fkey" FOREIGN KEY ("tontineId") REFERENCES "ton_tontines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ton_cycles" ADD CONSTRAINT "ton_cycles_tontineId_fkey" FOREIGN KEY ("tontineId") REFERENCES "ton_tontines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ton_contributions" ADD CONSTRAINT "ton_contributions_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "ton_cycles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ton_priority_requests" ADD CONSTRAINT "ton_priority_requests_tontineId_fkey" FOREIGN KEY ("tontineId") REFERENCES "ton_tontines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wal_movements" ADD CONSTRAINT "wal_movements_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wal_wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wal_holds" ADD CONSTRAINT "wal_holds_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wal_wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wal_status_history" ADD CONSTRAINT "wal_status_history_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wal_wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pay_status_history" ADD CONSTRAINT "pay_status_history_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "pay_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cmp_rule_history" ADD CONSTRAINT "cmp_rule_history_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "cmp_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================================
-- Contraintes et protections non exprimables dans schema.prisma
-- ============================================================================

-- Invariants financiers (R-WAL-01, R-WAL-02, A-13)
ALTER TABLE "wal_wallets" ADD CONSTRAINT "wal_wallets_balance_non_negative"
  CHECK ("allowNegative" OR "balanceMinor" >= 0);
ALTER TABLE "wal_wallets" ADD CONSTRAINT "wal_wallets_blocked_bounds"
  CHECK ("blockedMinor" >= 0 AND ("allowNegative" OR "blockedMinor" <= "balanceMinor"));
ALTER TABLE "wal_wallets" ADD CONSTRAINT "wal_wallets_owner_consistency"
  CHECK (
    ("ownerType" = 'MEMBER' AND "memberId" IS NOT NULL AND NOT "allowNegative")
    OR ("ownerType" IN ('TONTINE_POOL', 'TONTINE_RESERVE') AND "tontineId" IS NOT NULL AND NOT "allowNegative")
    OR ("ownerType" = 'SYSTEM' AND "systemCode" IS NOT NULL)
  );
ALTER TABLE "wal_movements" ADD CONSTRAINT "wal_movements_amount_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "wal_holds" ADD CONSTRAINT "wal_holds_amount_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "trx_transactions" ADD CONSTRAINT "trx_transactions_amount_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "pay_payments" ADD CONSTRAINT "pay_payments_amount_positive" CHECK ("amountMinor" > 0 AND "feeMinor" >= 0);

-- Paramètres de tontine (US-4.1, R-TON-09)
ALTER TABLE "ton_tontines" ADD CONSTRAINT "ton_tontines_params"
  CHECK (
    "contributionMinor" > 0 AND "maxMembers" BETWEEN 3 AND 50
    AND "entryFeeMinor" >= 0 AND "collationMinor" >= 0
    AND "graceDays" >= 0 AND "lateFeeBps" BETWEEN 0 AND 10000 AND "suspendAfter" >= 1
  );
ALTER TABLE "ton_contributions" ADD CONSTRAINT "ton_contributions_amounts"
  CHECK ("amountMinor" > 0 AND "penaltyMinor" >= 0);

-- Un seul dossier KYC ouvert par membre (US-3.1)
CREATE UNIQUE INDEX "kyc_requests_one_open_per_member" ON "kyc_requests" ("memberId")
  WHERE "status" IN ('SUBMITTED', 'PROCESSING', 'REVIEW_REQUIRED');

-- Un seul cycle ouvert par tontine
CREATE UNIQUE INDEX "ton_cycles_one_open_per_tontine" ON "ton_cycles" ("tontineId")
  WHERE "status" IN ('IN_PROGRESS', 'PAYOUT_PENDING');

-- Un seul hold actif par référence métier (anti double réservation)
CREATE UNIQUE INDEX "wal_holds_one_active_per_reference" ON "wal_holds" ("walletId", "context", "referenceId")
  WHERE "status" = 'ACTIVE' AND "referenceId" IS NOT NULL;

-- Recherche partielle nom / prénom / email / téléphone (US-2.3)
CREATE INDEX "mbr_members_search_trgm" ON "mbr_members" USING gin (
  (lower("firstName" || ' ' || "lastName" || ' ' || coalesce("email"::text, '') || ' ' || coalesce("phone", ''))) gin_trgm_ops
);
CREATE INDEX "ton_members_tontine_status_member" ON "ton_members" ("tontineId", "status", "memberId");

-- Tables append-only : aucune modification ni suppression (US-6.5, R-WAL-05, R-MBR-06)
CREATE OR REPLACE FUNCTION "forbid_append_only_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La table % est en ajout seul (append-only)', TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_append_only" BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "forbid_append_only_mutation"();
CREATE TRIGGER "trx_audit_logs_append_only" BEFORE UPDATE OR DELETE ON "trx_audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "forbid_append_only_mutation"();
CREATE TRIGGER "wal_movements_append_only" BEFORE UPDATE OR DELETE ON "wal_movements"
  FOR EACH ROW EXECUTE FUNCTION "forbid_append_only_mutation"();
CREATE TRIGGER "mbr_audit_logs_append_only" BEFORE UPDATE OR DELETE ON "mbr_audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "forbid_append_only_mutation"();
