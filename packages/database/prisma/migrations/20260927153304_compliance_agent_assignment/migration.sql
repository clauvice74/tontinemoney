-- AlterEnum
ALTER TYPE "auth"."PlatformRole" ADD VALUE 'COMPLIANCE_AGENT';

-- AlterTable
ALTER TABLE "compliance"."cmp_cases" ADD COLUMN     "assignedAt" TIMESTAMPTZ(3),
ADD COLUMN     "assigneeId" UUID;

-- CreateIndex
CREATE INDEX "cmp_cases_assigneeId_status_idx" ON "compliance"."cmp_cases"("assigneeId", "status");

-- Assignation cohérente : agent et date renseignés ensemble
ALTER TABLE "compliance"."cmp_cases" ADD CONSTRAINT "cmp_cases_assignment_consistency"
  CHECK (("assigneeId" IS NULL) = ("assignedAt" IS NULL));
