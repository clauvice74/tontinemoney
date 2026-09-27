-- AlterTable
ALTER TABLE "platform"."outbox_events" ADD COLUMN     "tenantId" TEXT;

-- CreateTable
CREATE TABLE "platform"."event_dead_letters" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "topic" TEXT,
    "partition" INTEGER,
    "offset" TEXT,
    "eventId" TEXT,
    "eventType" TEXT,
    "eventVersion" INTEGER,
    "stage" TEXT NOT NULL,
    "consumers" TEXT[],
    "reason" TEXT NOT NULL,
    "rawMessage" TEXT NOT NULL,
    "headers" JSONB,
    "attempts" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedBy" UUID,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_dead_letters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_dead_letters_status_createdAt_idx" ON "platform"."event_dead_letters"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "event_dead_letters_topic_partition_offset_key" ON "platform"."event_dead_letters"("topic", "partition", "offset");

ALTER TABLE "platform"."event_dead_letters" ADD CONSTRAINT "event_dead_letters_values"
  CHECK (
    "source" IN ('kafka', 'inprocess')
    AND "stage" IN ('VALIDATION', 'PROCESSING')
    AND "status" IN ('OPEN', 'REPLAYED', 'DISCARDED')
    AND "attempts" >= 1
  );
