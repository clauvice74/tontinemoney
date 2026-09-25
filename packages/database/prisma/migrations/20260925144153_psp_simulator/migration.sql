-- CreateTable
CREATE TABLE "pay_sim_operations" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "merchantReference" TEXT NOT NULL,
    "scenario" TEXT,
    "destinationMasked" TEXT,
    "settledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pay_sim_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pay_sim_operations_reference_key" ON "pay_sim_operations"("reference");

-- CreateIndex
CREATE INDEX "pay_sim_operations_provider_createdAt_idx" ON "pay_sim_operations"("provider", "createdAt");
