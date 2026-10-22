-- E7: the till session that paid each return, and who processed it.

-- AlterTable
ALTER TABLE "sale_returns" ADD COLUMN     "posSessionId" TEXT,
ADD COLUMN     "processedByUserId" TEXT;

-- CreateIndex
CREATE INDEX "sale_returns_tenantId_posSessionId_idx" ON "sale_returns"("tenantId", "posSessionId");

-- AddForeignKey
ALTER TABLE "sale_returns" ADD CONSTRAINT "fk_sr_payout_session" FOREIGN KEY ("posSessionId", "tenantId") REFERENCES "pos_sessions"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
