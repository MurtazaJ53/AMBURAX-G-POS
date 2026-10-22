-- Stock transfers between stores (screens 28-29). Additive. Generated with prisma migrate diff;
-- the four known updatedAt default drifts are left out (latter.md).

-- CreateEnum
CREATE TYPE "StockTransferStatus" AS ENUM ('IN_TRANSIT', 'RECEIVED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockMovementType" ADD VALUE 'TRANSFER_OUT';
ALTER TYPE "StockMovementType" ADD VALUE 'TRANSFER_IN';

-- CreateTable
CREATE TABLE "stock_transfers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fromStoreId" TEXT NOT NULL,
    "toStoreId" TEXT NOT NULL,
    "status" "StockTransferStatus" NOT NULL DEFAULT 'IN_TRANSIT',
    "note" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "receivedByUserId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_transfer_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "receivedQuantity" INTEGER,
    "unitCostMinor" INTEGER,

    CONSTRAINT "stock_transfer_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_transfers_tenantId_status_createdAt_idx" ON "stock_transfers"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_tenantId_idempotencyKey_key" ON "stock_transfers"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "uq_st_id_tenant" ON "stock_transfers"("id", "tenantId");

-- CreateIndex
CREATE INDEX "stock_transfer_lines_transferId_idx" ON "stock_transfer_lines"("transferId");

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "fk_st_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "fk_st_from_store" FOREIGN KEY ("fromStoreId", "tenantId") REFERENCES "stores"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfers" ADD CONSTRAINT "fk_st_to_store" FOREIGN KEY ("toStoreId", "tenantId") REFERENCES "stores"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "fk_stl_transfer" FOREIGN KEY ("transferId", "tenantId") REFERENCES "stock_transfers"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "fk_stl_variant" FOREIGN KEY ("variantId", "tenantId") REFERENCES "product_variants"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A line moves at least one unit; what arrives is never negative nor more than was sent.
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_qty_check"
  CHECK ("quantity" > 0 AND ("receivedQuantity" IS NULL OR ("receivedQuantity" >= 0 AND "receivedQuantity" <= "quantity"))
         AND ("unitCostMinor" IS NULL OR "unitCostMinor" >= 0));
-- A transfer always goes between two different stores.
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_distinct_stores_check" CHECK ("fromStoreId" <> "toStoreId");
