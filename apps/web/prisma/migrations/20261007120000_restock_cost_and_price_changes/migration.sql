-- Restock at a new cost or a new selling price.
--
-- Additive only: one nullable column on the stock ledger and one new table. No existing row
-- changes meaning, so this needs no backfill.

-- CreateEnum
CREATE TYPE "PriceChangeStatus" AS ENUM ('PENDING', 'APPLIED', 'CANCELLED');

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "unitCostMinor" INTEGER;

-- CreateTable
CREATE TABLE "pending_price_changes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "newPriceMinor" INTEGER NOT NULL,
    "newMrpMinor" INTEGER,
    "previousPriceMinor" INTEGER NOT NULL,
    "previousMrpMinor" INTEGER,
    "unitsAhead" INTEGER NOT NULL,
    "status" "PriceChangeStatus" NOT NULL DEFAULT 'PENDING',
    "sourceMovementId" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "pending_price_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pending_price_changes_tenantId_variantId_status_idx" ON "pending_price_changes"("tenantId", "variantId", "status");

-- AddForeignKey
ALTER TABLE "pending_price_changes" ADD CONSTRAINT "pending_price_changes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_price_changes" ADD CONSTRAINT "pending_price_changes_variantId_tenantId_fkey" FOREIGN KEY ("variantId", "tenantId") REFERENCES "product_variants"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A cost belongs to goods arriving, and is never negative.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_unit_cost_check"
  CHECK ("unitCostMinor" IS NULL OR ("unitCostMinor" >= 0 AND "type" = 'RECEIPT'));

-- A queued price is a real price, and never above the MRP queued with it.
ALTER TABLE "pending_price_changes" ADD CONSTRAINT "pending_price_changes_price_check"
  CHECK ("newPriceMinor" > 0 AND ("newMrpMinor" IS NULL OR "newMrpMinor" >= "newPriceMinor"));
