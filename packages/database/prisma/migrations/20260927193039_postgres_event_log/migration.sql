-- AlterTable
ALTER TABLE "platform"."outbox_events" ADD COLUMN     "deliverySeq" BIGINT;

-- CreateTable
CREATE TABLE "platform"."event_subscriptions" (
    "group" TEXT NOT NULL,
    "position" BIGINT NOT NULL DEFAULT 0,
    "owner" TEXT,
    "leaseUntil" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_subscriptions_pkey" PRIMARY KEY ("group")
);

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_deliverySeq_key" ON "platform"."outbox_events"("deliverySeq");

-- Messages rejetés : source « postgres » (transport PostgreSQL, A-55)
ALTER TABLE "platform"."event_dead_letters" DROP CONSTRAINT "event_dead_letters_values";
ALTER TABLE "platform"."event_dead_letters" ADD CONSTRAINT "event_dead_letters_values"
  CHECK (
    "source" IN ('kafka', 'inprocess', 'postgres')
    AND "stage" IN ('VALIDATION', 'PROCESSING')
    AND "status" IN ('OPEN', 'REPLAYED', 'DISCARDED')
    AND "attempts" >= 1
  );
