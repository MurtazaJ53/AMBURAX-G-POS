-- Purchase receipts (Sprint 5; owner decision 2026-10-13: cost excluding GST, input GST stored).
-- Additive only. Generated with prisma migrate diff; the four pre-existing updatedAt default
-- drifts the diff also reported are deliberately left out (tracked in latter.md).

-- CreateTable
CREATE TABLE "purchase_receipts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "supplierInvoiceNo" TEXT NOT NULL,
    "supplierInvoiceDate" TIMESTAMP(3),
    "notes" TEXT,
    "taxableMinor" INTEGER NOT NULL,
    "inputTaxMinor" INTEGER NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_receipt_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCostMinor" INTEGER NOT NULL,
    "gstRateBp" INTEGER NOT NULL,
    "taxableMinor" INTEGER NOT NULL,
    "inputTaxMinor" INTEGER NOT NULL,
    "stockMovementId" TEXT NOT NULL,

    CONSTRAINT "purchase_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_receipts_tenantId_createdAt_idx" ON "purchase_receipts"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_receipts_tenantId_idempotencyKey_key" ON "purchase_receipts"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "uq_pr_id_tenant" ON "purchase_receipts"("id", "tenantId");

-- CreateIndex
CREATE INDEX "purchase_receipt_lines_receiptId_idx" ON "purchase_receipt_lines"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_supplier_id_tenant" ON "suppliers"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "fk_pr_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "fk_pr_store" FOREIGN KEY ("storeId", "tenantId") REFERENCES "stores"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "fk_pr_supplier" FOREIGN KEY ("supplierId", "tenantId") REFERENCES "suppliers"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "fk_prl_receipt" FOREIGN KEY ("receiptId", "tenantId") REFERENCES "purchase_receipts"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "fk_prl_variant" FOREIGN KEY ("variantId", "tenantId") REFERENCES "product_variants"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Quantities and money are never negative; a line is at least one unit.
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_values_check"
  CHECK ("quantity" > 0 AND "unitCostMinor" >= 0 AND "gstRateBp" >= 0 AND "gstRateBp" <= 10000);
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_totals_check"
  CHECK ("taxableMinor" >= 0 AND "inputTaxMinor" >= 0 AND "totalMinor" = "taxableMinor" + "inputTaxMinor");
