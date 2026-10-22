-- Migration: 20261008180000_sale_return_foundation
-- Foundation tables for Sale Returns & Exchanges (added in commit 21b7bf6).
-- Creates sale_returns, sale_return_items, and sale_return_payments.

CREATE TABLE "sale_returns" (
    "id"                TEXT NOT NULL,
    "tenantId"          TEXT NOT NULL,
    "storeId"           TEXT NOT NULL,
    "originalSaleId"    TEXT NOT NULL,
    "status"            "SaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "totalRefundMinor"  INTEGER NOT NULL,
    "reason"            TEXT,
    "idempotencyKey"    TEXT NOT NULL,
    "erpSyncStatus"     "ErpSyncStatus" NOT NULL DEFAULT 'PENDING',
    "erpInvoiceId"      TEXT,
    "amburaxExchangeId" TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_returns_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fk_sr_original_sale" FOREIGN KEY ("tenantId", "originalSaleId") REFERENCES "sales"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "sale_returns_tenantId_idempotencyKey_key" UNIQUE ("tenantId", "idempotencyKey")
);

CREATE INDEX "sale_returns_tenantId_storeId_idx" ON "sale_returns"("tenantId", "storeId");
CREATE INDEX "sale_returns_originalSaleId_idx" ON "sale_returns"("originalSaleId");

CREATE TABLE "sale_return_items" (
    "id"                 TEXT NOT NULL,
    "saleReturnId"       TEXT NOT NULL,
    "originalSaleItemId" TEXT NOT NULL,
    "quantity"           INTEGER NOT NULL,
    "refundMinor"        INTEGER NOT NULL,

    CONSTRAINT "sale_return_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fk_sri_sale_return" FOREIGN KEY ("saleReturnId") REFERENCES "sale_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "fk_sri_original_item" FOREIGN KEY ("originalSaleItemId") REFERENCES "sale_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "sale_return_items_saleReturnId_idx" ON "sale_return_items"("saleReturnId");
CREATE INDEX "sale_return_items_originalSaleItemId_idx" ON "sale_return_items"("originalSaleItemId");

CREATE TABLE "sale_return_payments" (
    "id"           TEXT NOT NULL,
    "saleReturnId" TEXT NOT NULL,
    "method"       "PaymentMethod" NOT NULL,
    "amountMinor"  INTEGER NOT NULL,
    "status"       "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "reference"    TEXT,
    "confirmedAt"  TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_return_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fk_srp_sale_return" FOREIGN KEY ("saleReturnId") REFERENCES "sale_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "sale_return_payments_saleReturnId_idx" ON "sale_return_payments"("saleReturnId");
