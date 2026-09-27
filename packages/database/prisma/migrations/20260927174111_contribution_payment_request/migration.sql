-- AlterTable
ALTER TABLE "tontines"."ton_contributions" ADD COLUMN     "paymentError" TEXT,
ADD COLUMN     "paymentRequestId" UUID,
ADD COLUMN     "paymentRequestedAt" TIMESTAMPTZ(3);
