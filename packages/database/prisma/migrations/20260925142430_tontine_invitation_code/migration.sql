-- AlterTable
ALTER TABLE "ton_invitations" ADD COLUMN     "codeHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ton_invitations_codeHash_key" ON "ton_invitations"("codeHash");
