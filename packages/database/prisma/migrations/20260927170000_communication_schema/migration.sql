-- Étape 8c : communication-service (comment envoyer) séparé de notification-service (quoi envoyer).
-- Le journal de livraison rejoint le schéma communication avec son propre type de canal
-- (aucun type partagé entre schémas) ; données conservées.
CREATE SCHEMA IF NOT EXISTS "communication";

CREATE TYPE "communication"."DeliveryChannel" AS ENUM ('SMS', 'EMAIL', 'PUSH');

ALTER TABLE "notifications"."ntf_outbound_messages"
  ALTER COLUMN "channel" TYPE "communication"."DeliveryChannel"
  USING ("channel"::text::"communication"."DeliveryChannel");
ALTER TABLE "notifications"."ntf_outbound_messages" SET SCHEMA "communication";

ALTER TABLE "communication"."ntf_outbound_messages"
  ADD COLUMN "recipientId" UUID,
  ADD COLUMN "priority" TEXT;
CREATE INDEX "ntf_outbound_messages_recipientId_channel_createdAt_idx"
  ON "communication"."ntf_outbound_messages"("recipientId", "channel", "createdAt");

DO $$
BEGIN
  EXECUTE format(
    'ALTER DATABASE %I SET search_path = %s',
    current_database(),
    '"$user", public, platform, auth, members, kyc, compliance, tontines, wallets, transactions, payments, notifications, communication, administration, payment_gateway'
  );
END
$$;
