-- CreateTable
CREATE TABLE "members"."mbr_tontine_memberships" (
    "id" UUID NOT NULL,
    "tontineId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL,
    "sourceVersion" BIGINT NOT NULL,

    CONSTRAINT "mbr_tontine_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions"."trx_payment_views" (
    "id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "transactionId" UUID,
    "sourceVersion" BIGINT NOT NULL,

    CONSTRAINT "trx_payment_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mbr_tontine_memberships_tontineId_status_idx" ON "members"."mbr_tontine_memberships"("tontineId", "status");

-- CreateIndex
CREATE INDEX "trx_payment_views_status_idx" ON "transactions"."trx_payment_views"("status");

-- Republication de l'état (initialise aussi ces projections ; sans effet sur une projection à jour)
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
