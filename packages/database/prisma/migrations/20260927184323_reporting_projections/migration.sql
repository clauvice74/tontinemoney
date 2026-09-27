-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "reporting";


-- Déplacement (données conservées) : rapports archivés → reporting
ALTER TABLE "administration"."adm_reports" SET SCHEMA "reporting";
ALTER TABLE "reporting"."adm_reports" RENAME TO "rpt_generated_reports";
ALTER TABLE "reporting"."rpt_generated_reports" RENAME CONSTRAINT "adm_reports_pkey" TO "rpt_generated_reports_pkey";

-- CreateTable
CREATE TABLE "reporting"."rpt_tontines" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "frequency" TEXT NOT NULL,
    "contributionMinor" BIGINT NOT NULL,
    "totalCycles" INTEGER,
    "reserveWalletId" UUID,
    "drawProof" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "archivedUntil" TIMESTAMPTZ(3),
    "sourceVersion" BIGINT NOT NULL,

    CONSTRAINT "rpt_tontines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting"."rpt_cycles" (
    "id" UUID NOT NULL,
    "tontineId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "beneficiaryId" UUID,
    "dueDate" DATE NOT NULL,
    "expectedMinor" BIGINT NOT NULL,
    "collectedMinor" BIGINT NOT NULL,
    "payoutMinor" BIGINT,
    "partialPayout" BOOLEAN NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "sourceVersion" BIGINT NOT NULL,

    CONSTRAINT "rpt_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting"."rpt_contributions" (
    "id" UUID NOT NULL,
    "tontineId" UUID NOT NULL,
    "cycleId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "penaltyMinor" BIGINT NOT NULL,
    "penaltyPaid" BOOLEAN NOT NULL,
    "dueDate" DATE NOT NULL,
    "paidAt" TIMESTAMPTZ(3),
    "sourceVersion" BIGINT NOT NULL,

    CONSTRAINT "rpt_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting"."rpt_tontine_members" (
    "id" UUID NOT NULL,
    "tontineId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "position" INTEGER,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL,
    "sourceVersion" BIGINT NOT NULL,

    CONSTRAINT "rpt_tontine_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting"."rpt_wallets" (
    "id" UUID NOT NULL,
    "ownerType" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "balanceMinor" BIGINT NOT NULL,
    "blockedMinor" BIGINT NOT NULL,
    "sourceVersion" BIGINT NOT NULL,

    CONSTRAINT "rpt_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting"."rpt_wallet_movements" (
    "id" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rpt_wallet_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting"."rpt_transactions" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "sourceVersion" BIGINT NOT NULL,

    CONSTRAINT "rpt_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting"."rpt_payments" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "feeMinor" BIGINT NOT NULL,
    "transactionId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "sourceVersion" BIGINT NOT NULL,

    CONSTRAINT "rpt_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting"."rpt_members" (
    "id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "kycLevel" TEXT NOT NULL,
    "sourceVersion" BIGINT NOT NULL,

    CONSTRAINT "rpt_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting"."rpt_kyc_requests" (
    "id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "submittedAt" TIMESTAMPTZ(3) NOT NULL,
    "sourceVersion" BIGINT NOT NULL,

    CONSTRAINT "rpt_kyc_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting"."rpt_aml_matches" (
    "id" UUID NOT NULL,
    "listName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "sourceVersion" BIGINT NOT NULL,

    CONSTRAINT "rpt_aml_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting"."rpt_violations" (
    "id" UUID NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rpt_violations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting"."rpt_cases" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "outcome" TEXT,
    "assigneeId" UUID,
    "openedAt" TIMESTAMPTZ(3) NOT NULL,
    "closedAt" TIMESTAMPTZ(3),
    "sourceVersion" BIGINT NOT NULL,

    CONSTRAINT "rpt_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reporting"."rpt_reconciliations" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "discrepancyCount" INTEGER NOT NULL,
    "alert" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "sourceVersion" BIGINT NOT NULL,

    CONSTRAINT "rpt_reconciliations_pkey" PRIMARY KEY ("id")
);

-- Index renommé
ALTER INDEX "reporting"."adm_reports_tontineId_kind_createdAt_idx" RENAME TO "rpt_generated_reports_tontineId_kind_createdAt_idx";

-- CreateIndex
CREATE INDEX "rpt_tontines_status_idx" ON "reporting"."rpt_tontines"("status");

-- CreateIndex
CREATE INDEX "rpt_cycles_tontineId_number_idx" ON "reporting"."rpt_cycles"("tontineId", "number");

-- CreateIndex
CREATE INDEX "rpt_cycles_status_completedAt_idx" ON "reporting"."rpt_cycles"("status", "completedAt");

-- CreateIndex
CREATE INDEX "rpt_contributions_tontineId_cycleId_idx" ON "reporting"."rpt_contributions"("tontineId", "cycleId");

-- CreateIndex
CREATE INDEX "rpt_contributions_dueDate_idx" ON "reporting"."rpt_contributions"("dueDate");

-- CreateIndex
CREATE INDEX "rpt_tontine_members_tontineId_status_idx" ON "reporting"."rpt_tontine_members"("tontineId", "status");

-- CreateIndex
CREATE INDEX "rpt_wallet_movements_createdAt_idx" ON "reporting"."rpt_wallet_movements"("createdAt");

-- CreateIndex
CREATE INDEX "rpt_transactions_status_completedAt_idx" ON "reporting"."rpt_transactions"("status", "completedAt");

-- CreateIndex
CREATE INDEX "rpt_transactions_createdAt_idx" ON "reporting"."rpt_transactions"("createdAt");

-- CreateIndex
CREATE INDEX "rpt_payments_createdAt_idx" ON "reporting"."rpt_payments"("createdAt");

-- CreateIndex
CREATE INDEX "rpt_payments_status_idx" ON "reporting"."rpt_payments"("status");

-- CreateIndex
CREATE INDEX "rpt_kyc_requests_status_idx" ON "reporting"."rpt_kyc_requests"("status");

-- CreateIndex
CREATE INDEX "rpt_violations_createdAt_idx" ON "reporting"."rpt_violations"("createdAt");

-- CreateIndex
CREATE INDEX "rpt_cases_status_idx" ON "reporting"."rpt_cases"("status");

-- CreateIndex
CREATE INDEX "rpt_reconciliations_createdAt_idx" ON "reporting"."rpt_reconciliations"("createdAt");

-- Instantanés d'état publiés par déclencheurs (A-54)
-- Généré par packages/database/scripts/cdc-snapshots.mjs --print — ne pas modifier à la main

CREATE OR REPLACE FUNCTION platform.cdc_iso(ts timestamptz) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

CREATE OR REPLACE FUNCTION platform.cdc_emit(
  p_type text, p_producer text, p_aggregate text, p_id text, p_payload jsonb
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  INSERT INTO platform.outbox_events
    ("id", "eventType", "eventVersion", "aggregateType", "aggregateId", "producer",
     "correlationId", "payload", "occurredAt")
  VALUES (
    gen_random_uuid(), p_type, 1, p_aggregate, p_id, p_producer,
    coalesce(nullif(current_setting('app.correlation_id', true), ''), 'cdc'),
    p_payload || jsonb_build_object(
      'capturedAt', platform.cdc_iso(v_now),
      -- Ordre des instantanés d'une même ligne (microsecondes, monotone sous verrou de ligne)
      'sourceVersion', ((extract(epoch FROM v_now) * 1000000)::bigint)::text
    ),
    v_now
  );
END $$;

CREATE OR REPLACE FUNCTION "tontines".cdc_ton_tontines() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r "tontines"."ton_tontines"%ROWTYPE;
  v_new jsonb;
  v_old jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    r := OLD;
    v_new := jsonb_build_object('id', r.id, 'name', r."name", 'status', r."status"::text, 'currency', r."currency", 'frequency', r."frequency"::text, 'contributionMinor', r."contributionMinor"::text, 'totalCycles', r."totalCycles", 'reserveWalletId', r."reserveWalletId", 'drawProof', r."drawProof", 'createdAt', platform.cdc_iso(r."createdAt"), 'startedAt', platform.cdc_iso(r."startedAt"), 'completedAt', platform.cdc_iso(r."completedAt"), 'archivedUntil', platform.cdc_iso(r."archivedUntil")) || '{"deleted": true}'::jsonb;
  ELSE
    r := NEW;
    v_new := jsonb_build_object('id', r.id, 'name', r."name", 'status', r."status"::text, 'currency', r."currency", 'frequency', r."frequency"::text, 'contributionMinor', r."contributionMinor"::text, 'totalCycles', r."totalCycles", 'reserveWalletId', r."reserveWalletId", 'drawProof', r."drawProof", 'createdAt', platform.cdc_iso(r."createdAt"), 'startedAt', platform.cdc_iso(r."startedAt"), 'completedAt', platform.cdc_iso(r."completedAt"), 'archivedUntil', platform.cdc_iso(r."archivedUntil")) || '{"deleted": false}'::jsonb;
    IF TG_OP = 'UPDATE' THEN
      r := OLD;
      v_old := jsonb_build_object('id', r.id, 'name', r."name", 'status', r."status"::text, 'currency', r."currency", 'frequency', r."frequency"::text, 'contributionMinor', r."contributionMinor"::text, 'totalCycles', r."totalCycles", 'reserveWalletId', r."reserveWalletId", 'drawProof', r."drawProof", 'createdAt', platform.cdc_iso(r."createdAt"), 'startedAt', platform.cdc_iso(r."startedAt"), 'completedAt', platform.cdc_iso(r."completedAt"), 'archivedUntil', platform.cdc_iso(r."archivedUntil")) || '{"deleted": false}'::jsonb;
      -- Aucune colonne publiée n'a changé : pas d'instantané
      IF v_old = v_new THEN RETURN NULL; END IF;
      r := NEW;
    END IF;
  END IF;
  PERFORM platform.cdc_emit('tontine.snapshot', 'tontines', 'tontine', r.id::text, v_new);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cdc_snapshot ON "tontines"."ton_tontines";

CREATE TRIGGER cdc_snapshot AFTER INSERT OR UPDATE OR DELETE ON "tontines"."ton_tontines"
  FOR EACH ROW EXECUTE FUNCTION "tontines".cdc_ton_tontines();

CREATE OR REPLACE FUNCTION "tontines".cdc_ton_cycles() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r "tontines"."ton_cycles"%ROWTYPE;
  v_new jsonb;
  v_old jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    r := OLD;
    v_new := jsonb_build_object('id', r.id, 'tontineId', r."tontineId", 'number', r."number", 'status', r."status"::text, 'beneficiaryId', r."beneficiaryId", 'dueDate', to_char(r."dueDate", 'YYYY-MM-DD'), 'expectedMinor', r."expectedMinor"::text, 'collectedMinor', r."collectedMinor"::text, 'payoutMinor', r."payoutMinor"::text, 'partialPayout', r."partialPayout", 'completedAt', platform.cdc_iso(r."completedAt")) || '{"deleted": true}'::jsonb;
  ELSE
    r := NEW;
    v_new := jsonb_build_object('id', r.id, 'tontineId', r."tontineId", 'number', r."number", 'status', r."status"::text, 'beneficiaryId', r."beneficiaryId", 'dueDate', to_char(r."dueDate", 'YYYY-MM-DD'), 'expectedMinor', r."expectedMinor"::text, 'collectedMinor', r."collectedMinor"::text, 'payoutMinor', r."payoutMinor"::text, 'partialPayout', r."partialPayout", 'completedAt', platform.cdc_iso(r."completedAt")) || '{"deleted": false}'::jsonb;
    IF TG_OP = 'UPDATE' THEN
      r := OLD;
      v_old := jsonb_build_object('id', r.id, 'tontineId', r."tontineId", 'number', r."number", 'status', r."status"::text, 'beneficiaryId', r."beneficiaryId", 'dueDate', to_char(r."dueDate", 'YYYY-MM-DD'), 'expectedMinor', r."expectedMinor"::text, 'collectedMinor', r."collectedMinor"::text, 'payoutMinor', r."payoutMinor"::text, 'partialPayout', r."partialPayout", 'completedAt', platform.cdc_iso(r."completedAt")) || '{"deleted": false}'::jsonb;
      -- Aucune colonne publiée n'a changé : pas d'instantané
      IF v_old = v_new THEN RETURN NULL; END IF;
      r := NEW;
    END IF;
  END IF;
  PERFORM platform.cdc_emit('tontine.cycle.snapshot', 'tontines', 'tontine-cycle', r.id::text, v_new);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cdc_snapshot ON "tontines"."ton_cycles";

CREATE TRIGGER cdc_snapshot AFTER INSERT OR UPDATE OR DELETE ON "tontines"."ton_cycles"
  FOR EACH ROW EXECUTE FUNCTION "tontines".cdc_ton_cycles();

CREATE OR REPLACE FUNCTION "tontines".cdc_ton_contributions() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r "tontines"."ton_contributions"%ROWTYPE;
  v_new jsonb;
  v_old jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    r := OLD;
    v_new := jsonb_build_object('id', r.id, 'tontineId', r."tontineId", 'cycleId', r."cycleId", 'memberId', r."memberId", 'status', r."status"::text, 'amountMinor', r."amountMinor"::text, 'penaltyMinor', r."penaltyMinor"::text, 'penaltyPaid', r."penaltyPaid", 'dueDate', to_char(r."dueDate", 'YYYY-MM-DD'), 'paidAt', platform.cdc_iso(r."paidAt")) || '{"deleted": true}'::jsonb;
  ELSE
    r := NEW;
    v_new := jsonb_build_object('id', r.id, 'tontineId', r."tontineId", 'cycleId', r."cycleId", 'memberId', r."memberId", 'status', r."status"::text, 'amountMinor', r."amountMinor"::text, 'penaltyMinor', r."penaltyMinor"::text, 'penaltyPaid', r."penaltyPaid", 'dueDate', to_char(r."dueDate", 'YYYY-MM-DD'), 'paidAt', platform.cdc_iso(r."paidAt")) || '{"deleted": false}'::jsonb;
    IF TG_OP = 'UPDATE' THEN
      r := OLD;
      v_old := jsonb_build_object('id', r.id, 'tontineId', r."tontineId", 'cycleId', r."cycleId", 'memberId', r."memberId", 'status', r."status"::text, 'amountMinor', r."amountMinor"::text, 'penaltyMinor', r."penaltyMinor"::text, 'penaltyPaid', r."penaltyPaid", 'dueDate', to_char(r."dueDate", 'YYYY-MM-DD'), 'paidAt', platform.cdc_iso(r."paidAt")) || '{"deleted": false}'::jsonb;
      -- Aucune colonne publiée n'a changé : pas d'instantané
      IF v_old = v_new THEN RETURN NULL; END IF;
      r := NEW;
    END IF;
  END IF;
  PERFORM platform.cdc_emit('tontine.contribution.snapshot', 'tontines', 'contribution', r.id::text, v_new);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cdc_snapshot ON "tontines"."ton_contributions";

CREATE TRIGGER cdc_snapshot AFTER INSERT OR UPDATE OR DELETE ON "tontines"."ton_contributions"
  FOR EACH ROW EXECUTE FUNCTION "tontines".cdc_ton_contributions();

CREATE OR REPLACE FUNCTION "tontines".cdc_ton_members() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r "tontines"."ton_members"%ROWTYPE;
  v_new jsonb;
  v_old jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    r := OLD;
    v_new := jsonb_build_object('id', r.id, 'tontineId', r."tontineId", 'memberId', r."memberId", 'role', r."role"::text, 'status', r."status"::text, 'position', r."position", 'joinedAt', platform.cdc_iso(r."joinedAt")) || '{"deleted": true}'::jsonb;
  ELSE
    r := NEW;
    v_new := jsonb_build_object('id', r.id, 'tontineId', r."tontineId", 'memberId', r."memberId", 'role', r."role"::text, 'status', r."status"::text, 'position', r."position", 'joinedAt', platform.cdc_iso(r."joinedAt")) || '{"deleted": false}'::jsonb;
    IF TG_OP = 'UPDATE' THEN
      r := OLD;
      v_old := jsonb_build_object('id', r.id, 'tontineId', r."tontineId", 'memberId', r."memberId", 'role', r."role"::text, 'status', r."status"::text, 'position', r."position", 'joinedAt', platform.cdc_iso(r."joinedAt")) || '{"deleted": false}'::jsonb;
      -- Aucune colonne publiée n'a changé : pas d'instantané
      IF v_old = v_new THEN RETURN NULL; END IF;
      r := NEW;
    END IF;
  END IF;
  PERFORM platform.cdc_emit('tontine.membership.snapshot', 'tontines', 'tontine-membership', r.id::text, v_new);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cdc_snapshot ON "tontines"."ton_members";

CREATE TRIGGER cdc_snapshot AFTER INSERT OR UPDATE OR DELETE ON "tontines"."ton_members"
  FOR EACH ROW EXECUTE FUNCTION "tontines".cdc_ton_members();

CREATE OR REPLACE FUNCTION "wallets".cdc_wal_wallets() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r "wallets"."wal_wallets"%ROWTYPE;
  v_new jsonb;
  v_old jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    r := OLD;
    v_new := jsonb_build_object('id', r.id, 'ownerType', r."ownerType"::text, 'status', r."status"::text, 'currency', r."currency", 'balanceMinor', r."balanceMinor"::text, 'blockedMinor', r."blockedMinor"::text) || '{"deleted": true}'::jsonb;
  ELSE
    r := NEW;
    v_new := jsonb_build_object('id', r.id, 'ownerType', r."ownerType"::text, 'status', r."status"::text, 'currency', r."currency", 'balanceMinor', r."balanceMinor"::text, 'blockedMinor', r."blockedMinor"::text) || '{"deleted": false}'::jsonb;
    IF TG_OP = 'UPDATE' THEN
      r := OLD;
      v_old := jsonb_build_object('id', r.id, 'ownerType', r."ownerType"::text, 'status', r."status"::text, 'currency', r."currency", 'balanceMinor', r."balanceMinor"::text, 'blockedMinor', r."blockedMinor"::text) || '{"deleted": false}'::jsonb;
      -- Aucune colonne publiée n'a changé : pas d'instantané
      IF v_old = v_new THEN RETURN NULL; END IF;
      r := NEW;
    END IF;
  END IF;
  PERFORM platform.cdc_emit('wallet.snapshot', 'wallets', 'wallet', r.id::text, v_new);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cdc_snapshot ON "wallets"."wal_wallets";

CREATE TRIGGER cdc_snapshot AFTER INSERT OR UPDATE OR DELETE ON "wallets"."wal_wallets"
  FOR EACH ROW EXECUTE FUNCTION "wallets".cdc_wal_wallets();

CREATE OR REPLACE FUNCTION "wallets".cdc_wal_movements() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r "wallets"."wal_movements"%ROWTYPE;
BEGIN
  r := NEW;
  PERFORM platform.cdc_emit('wallet.movement.recorded', 'wallets', 'wallet-movement', r.id::text,
    jsonb_build_object('id', r.id, 'walletId', r."walletId", 'type', r."type"::text, 'amountMinor', r."amountMinor"::text, 'createdAt', platform.cdc_iso(r."createdAt")));
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cdc_snapshot ON "wallets"."wal_movements";

CREATE TRIGGER cdc_snapshot AFTER INSERT ON "wallets"."wal_movements"
  FOR EACH ROW EXECUTE FUNCTION "wallets".cdc_wal_movements();

CREATE OR REPLACE FUNCTION "transactions".cdc_trx_transactions() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r "transactions"."trx_transactions"%ROWTYPE;
  v_new jsonb;
  v_old jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    r := OLD;
    v_new := jsonb_build_object('id', r.id, 'type', r."type"::text, 'status', r."status"::text, 'currency', r."currency", 'amountMinor', r."amountMinor"::text, 'createdAt', platform.cdc_iso(r."createdAt"), 'completedAt', platform.cdc_iso(r."completedAt")) || '{"deleted": true}'::jsonb;
  ELSE
    r := NEW;
    v_new := jsonb_build_object('id', r.id, 'type', r."type"::text, 'status', r."status"::text, 'currency', r."currency", 'amountMinor', r."amountMinor"::text, 'createdAt', platform.cdc_iso(r."createdAt"), 'completedAt', platform.cdc_iso(r."completedAt")) || '{"deleted": false}'::jsonb;
    IF TG_OP = 'UPDATE' THEN
      r := OLD;
      v_old := jsonb_build_object('id', r.id, 'type', r."type"::text, 'status', r."status"::text, 'currency', r."currency", 'amountMinor', r."amountMinor"::text, 'createdAt', platform.cdc_iso(r."createdAt"), 'completedAt', platform.cdc_iso(r."completedAt")) || '{"deleted": false}'::jsonb;
      -- Aucune colonne publiée n'a changé : pas d'instantané
      IF v_old = v_new THEN RETURN NULL; END IF;
      r := NEW;
    END IF;
  END IF;
  PERFORM platform.cdc_emit('transaction.snapshot', 'transactions', 'transaction', r.id::text, v_new);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cdc_snapshot ON "transactions"."trx_transactions";

CREATE TRIGGER cdc_snapshot AFTER INSERT OR UPDATE OR DELETE ON "transactions"."trx_transactions"
  FOR EACH ROW EXECUTE FUNCTION "transactions".cdc_trx_transactions();

CREATE OR REPLACE FUNCTION "transactions".cdc_trx_reconciliation_reports() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r "transactions"."trx_reconciliation_reports"%ROWTYPE;
  v_new jsonb;
  v_old jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    r := OLD;
    v_new := jsonb_build_object('id', r.id, 'kind', r."kind"::text, 'businessDate', to_char(r."businessDate", 'YYYY-MM-DD'), 'status', r."status", 'discrepancyCount', r."discrepancyCount", 'alert', r."alert", 'createdAt', platform.cdc_iso(r."createdAt")) || '{"deleted": true}'::jsonb;
  ELSE
    r := NEW;
    v_new := jsonb_build_object('id', r.id, 'kind', r."kind"::text, 'businessDate', to_char(r."businessDate", 'YYYY-MM-DD'), 'status', r."status", 'discrepancyCount', r."discrepancyCount", 'alert', r."alert", 'createdAt', platform.cdc_iso(r."createdAt")) || '{"deleted": false}'::jsonb;
    IF TG_OP = 'UPDATE' THEN
      r := OLD;
      v_old := jsonb_build_object('id', r.id, 'kind', r."kind"::text, 'businessDate', to_char(r."businessDate", 'YYYY-MM-DD'), 'status', r."status", 'discrepancyCount', r."discrepancyCount", 'alert', r."alert", 'createdAt', platform.cdc_iso(r."createdAt")) || '{"deleted": false}'::jsonb;
      -- Aucune colonne publiée n'a changé : pas d'instantané
      IF v_old = v_new THEN RETURN NULL; END IF;
      r := NEW;
    END IF;
  END IF;
  PERFORM platform.cdc_emit('reconciliation.report.snapshot', 'transactions', 'reconciliation-report', r.id::text, v_new);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cdc_snapshot ON "transactions"."trx_reconciliation_reports";

CREATE TRIGGER cdc_snapshot AFTER INSERT OR UPDATE OR DELETE ON "transactions"."trx_reconciliation_reports"
  FOR EACH ROW EXECUTE FUNCTION "transactions".cdc_trx_reconciliation_reports();

CREATE OR REPLACE FUNCTION "payments".cdc_pay_payments() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r "payments"."pay_payments"%ROWTYPE;
  v_new jsonb;
  v_old jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    r := OLD;
    v_new := jsonb_build_object('id', r.id, 'type', r."type"::text, 'status', r."status"::text, 'currency', r."currency", 'amountMinor', r."amountMinor"::text, 'feeMinor', r."feeMinor"::text, 'transactionId', r."transactionId", 'createdAt', platform.cdc_iso(r."createdAt"), 'completedAt', platform.cdc_iso(r."completedAt")) || '{"deleted": true}'::jsonb;
  ELSE
    r := NEW;
    v_new := jsonb_build_object('id', r.id, 'type', r."type"::text, 'status', r."status"::text, 'currency', r."currency", 'amountMinor', r."amountMinor"::text, 'feeMinor', r."feeMinor"::text, 'transactionId', r."transactionId", 'createdAt', platform.cdc_iso(r."createdAt"), 'completedAt', platform.cdc_iso(r."completedAt")) || '{"deleted": false}'::jsonb;
    IF TG_OP = 'UPDATE' THEN
      r := OLD;
      v_old := jsonb_build_object('id', r.id, 'type', r."type"::text, 'status', r."status"::text, 'currency', r."currency", 'amountMinor', r."amountMinor"::text, 'feeMinor', r."feeMinor"::text, 'transactionId', r."transactionId", 'createdAt', platform.cdc_iso(r."createdAt"), 'completedAt', platform.cdc_iso(r."completedAt")) || '{"deleted": false}'::jsonb;
      -- Aucune colonne publiée n'a changé : pas d'instantané
      IF v_old = v_new THEN RETURN NULL; END IF;
      r := NEW;
    END IF;
  END IF;
  PERFORM platform.cdc_emit('payment.snapshot', 'payments', 'payment', r.id::text, v_new);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cdc_snapshot ON "payments"."pay_payments";

CREATE TRIGGER cdc_snapshot AFTER INSERT OR UPDATE OR DELETE ON "payments"."pay_payments"
  FOR EACH ROW EXECUTE FUNCTION "payments".cdc_pay_payments();

CREATE OR REPLACE FUNCTION "members".cdc_mbr_members() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r "members"."mbr_members"%ROWTYPE;
  v_new jsonb;
  v_old jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    r := OLD;
    v_new := jsonb_build_object('id', r.id, 'status', r."status"::text, 'kycLevel', r."kycLevel"::text) || '{"deleted": true}'::jsonb;
  ELSE
    r := NEW;
    v_new := jsonb_build_object('id', r.id, 'status', r."status"::text, 'kycLevel', r."kycLevel"::text) || '{"deleted": false}'::jsonb;
    IF TG_OP = 'UPDATE' THEN
      r := OLD;
      v_old := jsonb_build_object('id', r.id, 'status', r."status"::text, 'kycLevel', r."kycLevel"::text) || '{"deleted": false}'::jsonb;
      -- Aucune colonne publiée n'a changé : pas d'instantané
      IF v_old = v_new THEN RETURN NULL; END IF;
      r := NEW;
    END IF;
  END IF;
  PERFORM platform.cdc_emit('member.snapshot', 'members', 'member', r.id::text, v_new);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cdc_snapshot ON "members"."mbr_members";

CREATE TRIGGER cdc_snapshot AFTER INSERT OR UPDATE OR DELETE ON "members"."mbr_members"
  FOR EACH ROW EXECUTE FUNCTION "members".cdc_mbr_members();

CREATE OR REPLACE FUNCTION "kyc".cdc_kyc_requests() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r "kyc"."kyc_requests"%ROWTYPE;
  v_new jsonb;
  v_old jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    r := OLD;
    v_new := jsonb_build_object('id', r.id, 'status', r."status"::text, 'submittedAt', platform.cdc_iso(r."submittedAt")) || '{"deleted": true}'::jsonb;
  ELSE
    r := NEW;
    v_new := jsonb_build_object('id', r.id, 'status', r."status"::text, 'submittedAt', platform.cdc_iso(r."submittedAt")) || '{"deleted": false}'::jsonb;
    IF TG_OP = 'UPDATE' THEN
      r := OLD;
      v_old := jsonb_build_object('id', r.id, 'status', r."status"::text, 'submittedAt', platform.cdc_iso(r."submittedAt")) || '{"deleted": false}'::jsonb;
      -- Aucune colonne publiée n'a changé : pas d'instantané
      IF v_old = v_new THEN RETURN NULL; END IF;
      r := NEW;
    END IF;
  END IF;
  PERFORM platform.cdc_emit('kyc.request.snapshot', 'kyc', 'kyc-request', r.id::text, v_new);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cdc_snapshot ON "kyc"."kyc_requests";

CREATE TRIGGER cdc_snapshot AFTER INSERT OR UPDATE OR DELETE ON "kyc"."kyc_requests"
  FOR EACH ROW EXECUTE FUNCTION "kyc".cdc_kyc_requests();

CREATE OR REPLACE FUNCTION "kyc".cdc_kyc_aml_matches() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r "kyc"."kyc_aml_matches"%ROWTYPE;
  v_new jsonb;
  v_old jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    r := OLD;
    v_new := jsonb_build_object('id', r.id, 'listName', r."listName", 'status', r."status"::text, 'createdAt', platform.cdc_iso(r."createdAt")) || '{"deleted": true}'::jsonb;
  ELSE
    r := NEW;
    v_new := jsonb_build_object('id', r.id, 'listName', r."listName", 'status', r."status"::text, 'createdAt', platform.cdc_iso(r."createdAt")) || '{"deleted": false}'::jsonb;
    IF TG_OP = 'UPDATE' THEN
      r := OLD;
      v_old := jsonb_build_object('id', r.id, 'listName', r."listName", 'status', r."status"::text, 'createdAt', platform.cdc_iso(r."createdAt")) || '{"deleted": false}'::jsonb;
      -- Aucune colonne publiée n'a changé : pas d'instantané
      IF v_old = v_new THEN RETURN NULL; END IF;
      r := NEW;
    END IF;
  END IF;
  PERFORM platform.cdc_emit('kyc.aml.match.snapshot', 'kyc', 'aml-match', r.id::text, v_new);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cdc_snapshot ON "kyc"."kyc_aml_matches";

CREATE TRIGGER cdc_snapshot AFTER INSERT OR UPDATE OR DELETE ON "kyc"."kyc_aml_matches"
  FOR EACH ROW EXECUTE FUNCTION "kyc".cdc_kyc_aml_matches();

CREATE OR REPLACE FUNCTION "compliance".cdc_cmp_violations() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r "compliance"."cmp_violations"%ROWTYPE;
BEGIN
  r := NEW;
  PERFORM platform.cdc_emit('compliance.violation.recorded', 'compliance', 'compliance-violation', r.id::text,
    jsonb_build_object('id', r.id, 'ruleCode', r."ruleCode", 'action', r."action"::text, 'operationType', r."operationType"::text, 'createdAt', platform.cdc_iso(r."createdAt")));
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cdc_snapshot ON "compliance"."cmp_violations";

CREATE TRIGGER cdc_snapshot AFTER INSERT ON "compliance"."cmp_violations"
  FOR EACH ROW EXECUTE FUNCTION "compliance".cdc_cmp_violations();

CREATE OR REPLACE FUNCTION "compliance".cdc_cmp_cases() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r "compliance"."cmp_cases"%ROWTYPE;
  v_new jsonb;
  v_old jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    r := OLD;
    v_new := jsonb_build_object('id', r.id, 'type', r."type"::text, 'status', r."status"::text, 'severity', r."severity"::text, 'outcome', r."outcome"::text, 'assigneeId', r."assigneeId", 'openedAt', platform.cdc_iso(r."openedAt"), 'closedAt', platform.cdc_iso(r."closedAt")) || '{"deleted": true}'::jsonb;
  ELSE
    r := NEW;
    v_new := jsonb_build_object('id', r.id, 'type', r."type"::text, 'status', r."status"::text, 'severity', r."severity"::text, 'outcome', r."outcome"::text, 'assigneeId', r."assigneeId", 'openedAt', platform.cdc_iso(r."openedAt"), 'closedAt', platform.cdc_iso(r."closedAt")) || '{"deleted": false}'::jsonb;
    IF TG_OP = 'UPDATE' THEN
      r := OLD;
      v_old := jsonb_build_object('id', r.id, 'type', r."type"::text, 'status', r."status"::text, 'severity', r."severity"::text, 'outcome', r."outcome"::text, 'assigneeId', r."assigneeId", 'openedAt', platform.cdc_iso(r."openedAt"), 'closedAt', platform.cdc_iso(r."closedAt")) || '{"deleted": false}'::jsonb;
      -- Aucune colonne publiée n'a changé : pas d'instantané
      IF v_old = v_new THEN RETURN NULL; END IF;
      r := NEW;
    END IF;
  END IF;
  PERFORM platform.cdc_emit('compliance.case.snapshot', 'compliance', 'compliance-case', r.id::text, v_new);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS cdc_snapshot ON "compliance"."cmp_cases";

CREATE TRIGGER cdc_snapshot AFTER INSERT OR UPDATE OR DELETE ON "compliance"."cmp_cases"
  FOR EACH ROW EXECUTE FUNCTION "compliance".cdc_cmp_cases();

-- Initialisation des projections : un instantané par ligne existante

SELECT platform.cdc_emit('tontine.snapshot', 'tontines', 'tontine', r.id::text,
  jsonb_build_object('id', r.id, 'name', r."name", 'status', r."status"::text, 'currency', r."currency", 'frequency', r."frequency"::text, 'contributionMinor', r."contributionMinor"::text, 'totalCycles', r."totalCycles", 'reserveWalletId', r."reserveWalletId", 'drawProof', r."drawProof", 'createdAt', platform.cdc_iso(r."createdAt"), 'startedAt', platform.cdc_iso(r."startedAt"), 'completedAt', platform.cdc_iso(r."completedAt"), 'archivedUntil', platform.cdc_iso(r."archivedUntil")) || '{"deleted": false}'::jsonb)
FROM "tontines"."ton_tontines" r;

SELECT platform.cdc_emit('tontine.cycle.snapshot', 'tontines', 'tontine-cycle', r.id::text,
  jsonb_build_object('id', r.id, 'tontineId', r."tontineId", 'number', r."number", 'status', r."status"::text, 'beneficiaryId', r."beneficiaryId", 'dueDate', to_char(r."dueDate", 'YYYY-MM-DD'), 'expectedMinor', r."expectedMinor"::text, 'collectedMinor', r."collectedMinor"::text, 'payoutMinor', r."payoutMinor"::text, 'partialPayout', r."partialPayout", 'completedAt', platform.cdc_iso(r."completedAt")) || '{"deleted": false}'::jsonb)
FROM "tontines"."ton_cycles" r;

SELECT platform.cdc_emit('tontine.contribution.snapshot', 'tontines', 'contribution', r.id::text,
  jsonb_build_object('id', r.id, 'tontineId', r."tontineId", 'cycleId', r."cycleId", 'memberId', r."memberId", 'status', r."status"::text, 'amountMinor', r."amountMinor"::text, 'penaltyMinor', r."penaltyMinor"::text, 'penaltyPaid', r."penaltyPaid", 'dueDate', to_char(r."dueDate", 'YYYY-MM-DD'), 'paidAt', platform.cdc_iso(r."paidAt")) || '{"deleted": false}'::jsonb)
FROM "tontines"."ton_contributions" r;

SELECT platform.cdc_emit('tontine.membership.snapshot', 'tontines', 'tontine-membership', r.id::text,
  jsonb_build_object('id', r.id, 'tontineId', r."tontineId", 'memberId', r."memberId", 'role', r."role"::text, 'status', r."status"::text, 'position', r."position", 'joinedAt', platform.cdc_iso(r."joinedAt")) || '{"deleted": false}'::jsonb)
FROM "tontines"."ton_members" r;

SELECT platform.cdc_emit('wallet.snapshot', 'wallets', 'wallet', r.id::text,
  jsonb_build_object('id', r.id, 'ownerType', r."ownerType"::text, 'status', r."status"::text, 'currency', r."currency", 'balanceMinor', r."balanceMinor"::text, 'blockedMinor', r."blockedMinor"::text) || '{"deleted": false}'::jsonb)
FROM "wallets"."wal_wallets" r;

SELECT platform.cdc_emit('wallet.movement.recorded', 'wallets', 'wallet-movement', r.id::text,
  jsonb_build_object('id', r.id, 'walletId', r."walletId", 'type', r."type"::text, 'amountMinor', r."amountMinor"::text, 'createdAt', platform.cdc_iso(r."createdAt")))
FROM "wallets"."wal_movements" r;

SELECT platform.cdc_emit('transaction.snapshot', 'transactions', 'transaction', r.id::text,
  jsonb_build_object('id', r.id, 'type', r."type"::text, 'status', r."status"::text, 'currency', r."currency", 'amountMinor', r."amountMinor"::text, 'createdAt', platform.cdc_iso(r."createdAt"), 'completedAt', platform.cdc_iso(r."completedAt")) || '{"deleted": false}'::jsonb)
FROM "transactions"."trx_transactions" r;

SELECT platform.cdc_emit('reconciliation.report.snapshot', 'transactions', 'reconciliation-report', r.id::text,
  jsonb_build_object('id', r.id, 'kind', r."kind"::text, 'businessDate', to_char(r."businessDate", 'YYYY-MM-DD'), 'status', r."status", 'discrepancyCount', r."discrepancyCount", 'alert', r."alert", 'createdAt', platform.cdc_iso(r."createdAt")) || '{"deleted": false}'::jsonb)
FROM "transactions"."trx_reconciliation_reports" r;

SELECT platform.cdc_emit('payment.snapshot', 'payments', 'payment', r.id::text,
  jsonb_build_object('id', r.id, 'type', r."type"::text, 'status', r."status"::text, 'currency', r."currency", 'amountMinor', r."amountMinor"::text, 'feeMinor', r."feeMinor"::text, 'transactionId', r."transactionId", 'createdAt', platform.cdc_iso(r."createdAt"), 'completedAt', platform.cdc_iso(r."completedAt")) || '{"deleted": false}'::jsonb)
FROM "payments"."pay_payments" r;

SELECT platform.cdc_emit('member.snapshot', 'members', 'member', r.id::text,
  jsonb_build_object('id', r.id, 'status', r."status"::text, 'kycLevel', r."kycLevel"::text) || '{"deleted": false}'::jsonb)
FROM "members"."mbr_members" r;

SELECT platform.cdc_emit('kyc.request.snapshot', 'kyc', 'kyc-request', r.id::text,
  jsonb_build_object('id', r.id, 'status', r."status"::text, 'submittedAt', platform.cdc_iso(r."submittedAt")) || '{"deleted": false}'::jsonb)
FROM "kyc"."kyc_requests" r;

SELECT platform.cdc_emit('kyc.aml.match.snapshot', 'kyc', 'aml-match', r.id::text,
  jsonb_build_object('id', r.id, 'listName', r."listName", 'status', r."status"::text, 'createdAt', platform.cdc_iso(r."createdAt")) || '{"deleted": false}'::jsonb)
FROM "kyc"."kyc_aml_matches" r;

SELECT platform.cdc_emit('compliance.violation.recorded', 'compliance', 'compliance-violation', r.id::text,
  jsonb_build_object('id', r.id, 'ruleCode', r."ruleCode", 'action', r."action"::text, 'operationType', r."operationType"::text, 'createdAt', platform.cdc_iso(r."createdAt")))
FROM "compliance"."cmp_violations" r;

SELECT platform.cdc_emit('compliance.case.snapshot', 'compliance', 'compliance-case', r.id::text,
  jsonb_build_object('id', r.id, 'type', r."type"::text, 'status', r."status"::text, 'severity', r."severity"::text, 'outcome', r."outcome"::text, 'assigneeId', r."assigneeId", 'openedAt', platform.cdc_iso(r."openedAt"), 'closedAt', platform.cdc_iso(r."closedAt")) || '{"deleted": false}'::jsonb)
FROM "compliance"."cmp_cases" r;
