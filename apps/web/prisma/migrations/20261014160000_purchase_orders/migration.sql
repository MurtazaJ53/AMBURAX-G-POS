-- Screens 47-48: purchase orders (ERPNext Purchase Order is master) and receipt links to them.
-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('OPEN', 'CANCELLED');

-- AlterTable
ALTER TABLE "purchase_receipt_lines" ADD COLUMN     "purchaseOrderLineId" TEXT;

-- AlterTable
ALTER TABLE "purchase_receipts" ADD COLUMN     "purchaseOrderId" TEXT;

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'OPEN',
    "expectedDate" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "taxableMinor" INTEGER NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "erpnextName" TEXT,
    "erpSyncStatus" "ErpSyncStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "receivedQuantity" INTEGER NOT NULL DEFAULT 0,
    "unitCostMinor" INTEGER NOT NULL,
    "gstRateBp" INTEGER NOT NULL,
    "erpnextItemName" TEXT,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_orders_tenantId_storeId_createdAt_idx" ON "purchase_orders"("tenantId", "storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_tenantId_idempotencyKey_key" ON "purchase_orders"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "uq_po_id_tenant" ON "purchase_orders"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_pol_id_tenant" ON "purchase_order_lines"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "fk_pr_po" FOREIGN KEY ("purchaseOrderId", "tenantId") REFERENCES "purchase_orders"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "fk_prl_pol" FOREIGN KEY ("purchaseOrderLineId", "tenantId") REFERENCES "purchase_order_lines"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "fk_po_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "fk_po_store" FOREIGN KEY ("storeId", "tenantId") REFERENCES "stores"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "fk_po_supplier" FOREIGN KEY ("supplierId", "tenantId") REFERENCES "suppliers"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "fk_pol_order" FOREIGN KEY ("orderId", "tenantId") REFERENCES "purchase_orders"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "fk_pol_variant" FOREIGN KEY ("variantId", "tenantId") REFERENCES "product_variants"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
