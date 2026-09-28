-- AlterTable
ALTER TABLE "auth"."auth_refresh_sessions" ADD COLUMN     "persistent" BOOLEAN NOT NULL DEFAULT true;
