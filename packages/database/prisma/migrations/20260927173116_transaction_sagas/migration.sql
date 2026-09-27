-- CreateEnum
CREATE TYPE "transactions"."SagaStatus" AS ENUM ('STARTED', 'COMPLETED', 'FAILED', 'COMPENSATED');

-- CreateTable
CREATE TABLE "transactions"."trx_sagas" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "sagaKey" TEXT NOT NULL,
    "status" "transactions"."SagaStatus" NOT NULL DEFAULT 'STARTED',
    "step" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "request" JSONB NOT NULL,
    "transactionId" UUID,
    "failureCode" TEXT,
    "failureReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "trx_sagas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions"."trx_saga_steps" (
    "id" UUID NOT NULL,
    "sagaId" UUID NOT NULL,
    "fromStep" TEXT,
    "toStep" TEXT NOT NULL,
    "status" "transactions"."SagaStatus" NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trx_saga_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trx_sagas_sagaKey_key" ON "transactions"."trx_sagas"("sagaKey");

-- CreateIndex
CREATE INDEX "trx_sagas_status_updatedAt_idx" ON "transactions"."trx_sagas"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "trx_sagas_type_reference_idx" ON "transactions"."trx_sagas"("type", "reference");

-- CreateIndex
CREATE INDEX "trx_saga_steps_sagaId_createdAt_idx" ON "transactions"."trx_saga_steps"("sagaId", "createdAt");

-- AddForeignKey
ALTER TABLE "transactions"."trx_saga_steps" ADD CONSTRAINT "trx_saga_steps_sagaId_fkey" FOREIGN KEY ("sagaId") REFERENCES "transactions"."trx_sagas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
