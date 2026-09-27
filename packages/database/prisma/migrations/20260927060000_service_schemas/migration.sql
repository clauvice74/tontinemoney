-- Extraction, étape 4 : un schéma PostgreSQL par service (docs/data-ownership.md).
-- Migration écrite à la main : ALTER … SET SCHEMA déplace tables, données, index, contraintes,
-- séquences et triggers sans rien recréer (un diff automatique aurait supprimé puis recréé les tables).
-- `public` ne conserve que les extensions (citext, pg_trgm) et la fonction append-only.

CREATE SCHEMA IF NOT EXISTS "platform";
CREATE SCHEMA IF NOT EXISTS "auth";
CREATE SCHEMA IF NOT EXISTS "members";
CREATE SCHEMA IF NOT EXISTS "kyc";
CREATE SCHEMA IF NOT EXISTS "compliance";
CREATE SCHEMA IF NOT EXISTS "tontines";
CREATE SCHEMA IF NOT EXISTS "wallets";
CREATE SCHEMA IF NOT EXISTS "transactions";
CREATE SCHEMA IF NOT EXISTS "payments";
CREATE SCHEMA IF NOT EXISTS "notifications";
CREATE SCHEMA IF NOT EXISTS "administration";
CREATE SCHEMA IF NOT EXISTS "payment_gateway";

-- Type propre au KYC : plus aucune dépendance de type entre les schémas kyc et members
CREATE TYPE "kyc"."KycTargetLevel" AS ENUM ('NONE', 'TIER_1', 'TIER_2', 'TIER_3');
ALTER TABLE "kyc_requests"
  ALTER COLUMN "targetLevel" TYPE "kyc"."KycTargetLevel" USING ("targetLevel"::text::"kyc"."KycTargetLevel");

-- Types énumérés
ALTER TYPE "PlatformRole" SET SCHEMA "auth";
ALTER TYPE "UserStatus" SET SCHEMA "auth";
ALTER TYPE "CommunicationChannel" SET SCHEMA "auth";
ALTER TYPE "MfaType" SET SCHEMA "auth";
ALTER TYPE "AuthTokenType" SET SCHEMA "auth";
ALTER TYPE "AccessRequestStatus" SET SCHEMA "auth";
ALTER TYPE "MemberStatus" SET SCHEMA "members";
ALTER TYPE "KycLevel" SET SCHEMA "members";
ALTER TYPE "ComplianceStatus" SET SCHEMA "members";
ALTER TYPE "Gender" SET SCHEMA "members";
ALTER TYPE "MemberAuditAction" SET SCHEMA "members";
ALTER TYPE "ActorRole" SET SCHEMA "members";
ALTER TYPE "KycRequestStatus" SET SCHEMA "kyc";
ALTER TYPE "KycDocumentType" SET SCHEMA "kyc";
ALTER TYPE "KycFileKind" SET SCHEMA "kyc";
ALTER TYPE "KycCheckStep" SET SCHEMA "kyc";
ALTER TYPE "KycCheckOutcome" SET SCHEMA "kyc";
ALTER TYPE "KycRejectCategory" SET SCHEMA "kyc";
ALTER TYPE "AlertStatus" SET SCHEMA "kyc";
ALTER TYPE "ComplianceCaseType" SET SCHEMA "compliance";
ALTER TYPE "ComplianceCaseStatus" SET SCHEMA "compliance";
ALTER TYPE "CaseSeverity" SET SCHEMA "compliance";
ALTER TYPE "CaseOutcome" SET SCHEMA "compliance";
ALTER TYPE "ComplianceAlertType" SET SCHEMA "compliance";
ALTER TYPE "TontineType" SET SCHEMA "tontines";
ALTER TYPE "TontineStatus" SET SCHEMA "tontines";
ALTER TYPE "TontineFrequency" SET SCHEMA "tontines";
ALTER TYPE "DrawMode" SET SCHEMA "tontines";
ALTER TYPE "IncompletePolicy" SET SCHEMA "tontines";
ALTER TYPE "TontineMemberRole" SET SCHEMA "tontines";
ALTER TYPE "TontineMemberStatus" SET SCHEMA "tontines";
ALTER TYPE "InvitationChannel" SET SCHEMA "tontines";
ALTER TYPE "InvitationStatus" SET SCHEMA "tontines";
ALTER TYPE "CycleStatus" SET SCHEMA "tontines";
ALTER TYPE "ContributionStatus" SET SCHEMA "tontines";
ALTER TYPE "PriorityRequestStatus" SET SCHEMA "tontines";
ALTER TYPE "WalletOwnerType" SET SCHEMA "wallets";
ALTER TYPE "WalletStatus" SET SCHEMA "wallets";
ALTER TYPE "MovementType" SET SCHEMA "wallets";
ALTER TYPE "MovementContext" SET SCHEMA "wallets";
ALTER TYPE "HoldStatus" SET SCHEMA "wallets";
ALTER TYPE "TransactionType" SET SCHEMA "transactions";
ALTER TYPE "TransactionStatus" SET SCHEMA "transactions";
ALTER TYPE "TransactionContextType" SET SCHEMA "transactions";
ALTER TYPE "PaymentType" SET SCHEMA "payments";
ALTER TYPE "PaymentMethod" SET SCHEMA "payments";
ALTER TYPE "PaymentStatus" SET SCHEMA "payments";
ALTER TYPE "NotificationPriority" SET SCHEMA "notifications";
ALTER TYPE "NotificationChannel" SET SCHEMA "notifications";
ALTER TYPE "NotificationCategory" SET SCHEMA "notifications";
ALTER TYPE "NotificationStatus" SET SCHEMA "notifications";
ALTER TYPE "OperationType" SET SCHEMA "compliance";
ALTER TYPE "ComplianceRuleType" SET SCHEMA "compliance";
ALTER TYPE "ViolationAction" SET SCHEMA "compliance";
ALTER TYPE "TontineAccountType" SET SCHEMA "administration";
ALTER TYPE "MessageTemplate" SET SCHEMA "administration";
ALTER TYPE "AuditResult" SET SCHEMA "platform";
ALTER TYPE "OutboxStatus" SET SCHEMA "platform";
ALTER TYPE "IdempotencyStatus" SET SCHEMA "platform";
ALTER TYPE "ReconciliationKind" SET SCHEMA "transactions";

-- Tables
ALTER TABLE "outbox_events" SET SCHEMA "platform";
ALTER TABLE "processed_events" SET SCHEMA "platform";
ALTER TABLE "idempotency_keys" SET SCHEMA "platform";
ALTER TABLE "audit_logs" SET SCHEMA "platform";
ALTER TABLE "job_runs" SET SCHEMA "platform";
ALTER TABLE "auth_users" SET SCHEMA "auth";
ALTER TABLE "auth_password_history" SET SCHEMA "auth";
ALTER TABLE "auth_tokens" SET SCHEMA "auth";
ALTER TABLE "auth_refresh_sessions" SET SCHEMA "auth";
ALTER TABLE "auth_login_attempts" SET SCHEMA "auth";
ALTER TABLE "auth_recovery_codes" SET SCHEMA "auth";
ALTER TABLE "auth_known_devices" SET SCHEMA "auth";
ALTER TABLE "auth_access_requests" SET SCHEMA "auth";
ALTER TABLE "mbr_members" SET SCHEMA "members";
ALTER TABLE "mbr_audit_logs" SET SCHEMA "members";
ALTER TABLE "kyc_requests" SET SCHEMA "kyc";
ALTER TABLE "kyc_documents" SET SCHEMA "kyc";
ALTER TABLE "kyc_checks" SET SCHEMA "kyc";
ALTER TABLE "kyc_agent_actions" SET SCHEMA "kyc";
ALTER TABLE "kyc_biometric_templates" SET SCHEMA "kyc";
ALTER TABLE "kyc_duplicate_alerts" SET SCHEMA "kyc";
ALTER TABLE "kyc_aml_matches" SET SCHEMA "kyc";
ALTER TABLE "kyc_aml_whitelist" SET SCHEMA "kyc";
ALTER TABLE "ton_tontines" SET SCHEMA "tontines";
ALTER TABLE "ton_members" SET SCHEMA "tontines";
ALTER TABLE "ton_invitations" SET SCHEMA "tontines";
ALTER TABLE "ton_cycles" SET SCHEMA "tontines";
ALTER TABLE "ton_contributions" SET SCHEMA "tontines";
ALTER TABLE "ton_priority_requests" SET SCHEMA "tontines";
ALTER TABLE "wal_wallets" SET SCHEMA "wallets";
ALTER TABLE "wal_movements" SET SCHEMA "wallets";
ALTER TABLE "wal_holds" SET SCHEMA "wallets";
ALTER TABLE "wal_status_history" SET SCHEMA "wallets";
ALTER TABLE "trx_transactions" SET SCHEMA "transactions";
ALTER TABLE "trx_audit_logs" SET SCHEMA "transactions";
ALTER TABLE "trx_reconciliation_reports" SET SCHEMA "transactions";
ALTER TABLE "pay_payments" SET SCHEMA "payments";
ALTER TABLE "pay_status_history" SET SCHEMA "payments";
ALTER TABLE "pay_sim_operations" SET SCHEMA "payments";
ALTER TABLE "pay_webhook_events" SET SCHEMA "payments";
ALTER TABLE "pgw_webhook_receipts" SET SCHEMA "payment_gateway";
ALTER TABLE "ntf_templates" SET SCHEMA "notifications";
ALTER TABLE "ntf_notifications" SET SCHEMA "notifications";
ALTER TABLE "ntf_outbound_messages" SET SCHEMA "notifications";
ALTER TABLE "cmp_rules" SET SCHEMA "compliance";
ALTER TABLE "cmp_rule_history" SET SCHEMA "compliance";
ALTER TABLE "cmp_violations" SET SCHEMA "compliance";
ALTER TABLE "cmp_cases" SET SCHEMA "compliance";
ALTER TABLE "cmp_case_alerts" SET SCHEMA "compliance";
ALTER TABLE "adm_tontine_accounts" SET SCHEMA "administration";
ALTER TABLE "adm_reports" SET SCHEMA "administration";
ALTER TABLE "adm_messages" SET SCHEMA "administration";

-- Résolution des noms non qualifiés (requêtes SQL brutes, outils) : chemin de recherche par défaut
-- de la base ; les clients applicatifs le fixent aussi à la connexion (packages/database).
DO $$
BEGIN
  EXECUTE format(
    'ALTER DATABASE %I SET search_path = %s',
    current_database(),
    '"$user", public, platform, auth, members, kyc, compliance, tontines, wallets, transactions, payments, notifications, administration, payment_gateway'
  );
END
$$;
