-- CreateTable
CREATE TABLE "pgw_webhook_receipts" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "bodySha256" CHAR(64) NOT NULL,
    "merchantReference" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'RECEIVED',
    "claimedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "forwardedAt" TIMESTAMPTZ(3),

    CONSTRAINT "pgw_webhook_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pgw_webhook_receipts_state_receivedAt_idx" ON "pgw_webhook_receipts"("state", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "pgw_webhook_receipts_provider_providerEventId_key" ON "pgw_webhook_receipts"("provider", "providerEventId");

-- États et montants cohérents
ALTER TABLE "pgw_webhook_receipts" ADD CONSTRAINT "pgw_webhook_receipts_values"
  CHECK (
    "state" IN ('RECEIVED', 'FORWARDED', 'FORWARD_FAILED')
    AND "status" IN ('SUCCESS', 'FAILED')
    AND "amountMinor" > 0
    AND "attempts" >= 0
  );
