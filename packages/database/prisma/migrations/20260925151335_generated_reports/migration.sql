-- CreateTable
CREATE TABLE "adm_reports" (
    "id" UUID NOT NULL,
    "tontineId" UUID,
    "kind" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "createdById" UUID,
    "retainUntil" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adm_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "adm_reports_tontineId_kind_createdAt_idx" ON "adm_reports"("tontineId", "kind", "createdAt" DESC);
