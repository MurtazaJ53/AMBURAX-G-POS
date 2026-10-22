-- Weighted average cost, manager approval PIN, and returns to supplier (owner decisions
-- 2026-10-14). Additive only. Generated with prisma migrate diff; the four pre-existing
-- updatedAt default drifts it also reported are left out (tracked in latter.md).

-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'SUPPLIER_RETURN';

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "unitCostMinor" INTEGER;

-- AlterTable
ALTER TABLE "stock_levels" ADD COLUMN     "avgCostMinor" INTEGER,
ADD COLUMN     "costIsEstimate" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "approvalPinFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "approvalPinHash" TEXT,
ADD COLUMN     "approvalPinLockedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "purchase_returns" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "taxableMinor" INTEGER NOT NULL,
    "inputTaxMinor" INTEGER NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_return_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "returnId" TEXT NOT NULL,
    "receiptLineId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "taxableMinor" INTEGER NOT NULL,
    "inputTaxMinor" INTEGER NOT NULL,
    "stockMovementId" TEXT NOT NULL,

    CONSTRAINT "purchase_return_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_returns_receiptId_idx" ON "purchase_returns"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_returns_tenantId_idempotencyKey_key" ON "purchase_returns"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "uq_pret_id_tenant" ON "purchase_returns"("id", "tenantId");

-- CreateIndex
CREATE INDEX "purchase_return_lines_receiptLineId_idx" ON "purchase_return_lines"("receiptLineId");

-- CreateIndex
CREATE UNIQUE INDEX "uq_prl_id_tenant" ON "purchase_receipt_lines"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "fk_pret_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_returns" ADD CONSTRAINT "fk_pret_receipt" FOREIGN KEY ("receiptId", "tenantId") REFERENCES "purchase_receipts"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "fk_pretl_return" FOREIGN KEY ("returnId", "tenantId") REFERENCES "purchase_returns"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "fk_pretl_receipt_line" FOREIGN KEY ("receiptLineId", "tenantId") REFERENCES "purchase_receipt_lines"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A cost is never negative; a returned line is at least one unit; totals add up.
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_avg_cost_check" CHECK ("avgCostMinor" IS NULL OR "avgCostMinor" >= 0);
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_unit_cost_check" CHECK ("unitCostMinor" IS NULL OR "unitCostMinor" >= 0);
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_values_check"
  CHECK ("quantity" > 0 AND "taxableMinor" >= 0 AND "inputTaxMinor" >= 0);
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_totals_check"
  CHECK ("totalMinor" = "taxableMinor" + "inputTaxMinor");
