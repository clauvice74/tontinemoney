-- CreateEnum
CREATE TYPE "ComplianceCaseType" AS ENUM ('AML_SCREENING', 'DUPLICATE_IDENTITY', 'RULE_VIOLATION', 'FRAUD');

-- CreateEnum
CREATE TYPE "ComplianceCaseStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CaseSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "CaseOutcome" AS ENUM ('CONFIRMED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ComplianceAlertType" AS ENUM ('AML_MATCH', 'DUPLICATE_ALERT', 'VIOLATION', 'FRAUD_FLAG');

-- CreateTable
CREATE TABLE "cmp_cases" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "type" "ComplianceCaseType" NOT NULL,
    "status" "ComplianceCaseStatus" NOT NULL DEFAULT 'OPEN',
    "severity" "CaseSeverity" NOT NULL,
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "closedAt" TIMESTAMPTZ(3),
    "closedBy" UUID,
    "outcome" "CaseOutcome",
    "closingComment" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "cmp_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cmp_case_alerts" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "alertType" "ComplianceAlertType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "open" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "cmp_case_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cmp_cases_status_openedAt_idx" ON "cmp_cases"("status", "openedAt");

-- CreateIndex
CREATE INDEX "cmp_cases_memberId_status_idx" ON "cmp_cases"("memberId", "status");

-- CreateIndex
CREATE INDEX "cmp_case_alerts_caseId_idx" ON "cmp_case_alerts"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "cmp_case_alerts_alertType_sourceId_key" ON "cmp_case_alerts"("alertType", "sourceId");

-- AddForeignKey
ALTER TABLE "cmp_case_alerts" ADD CONSTRAINT "cmp_case_alerts_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "cmp_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Un seul dossier ouvert par membre et par type : les nouvelles alertes s'y rattachent
CREATE UNIQUE INDEX "cmp_cases_one_open_per_member_type" ON "cmp_cases" ("memberId", "type")
  WHERE "status" = 'OPEN';

-- Un dossier clos est définitif et porte obligatoirement sa décision
ALTER TABLE "cmp_cases" ADD CONSTRAINT "cmp_cases_closed_consistency"
  CHECK (
    ("status" = 'OPEN' AND "closedAt" IS NULL AND "outcome" IS NULL)
    OR ("status" = 'CLOSED' AND "closedAt" IS NOT NULL AND "closedBy" IS NOT NULL
        AND "outcome" IS NOT NULL AND "closingComment" IS NOT NULL)
  );
