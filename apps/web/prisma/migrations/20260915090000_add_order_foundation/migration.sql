-- P1-8G — order foundation.
--
-- Additive and non-destructive: two enum types, one new column with a default, three new
-- tables. No existing table is altered beyond that column, nothing is dropped, no data is
-- rewritten, and there is no backfill because there is nothing to backfill — orders start
-- empty and every existing Sale remains a Sale.
--
-- What this deliberately does NOT do:
--
--   * It does not touch `sales` or `sale_items`. An Order is a new, additive document for
--     demand before fulfilment; a Sale is still the completed retail transaction it always
--     was, and the POS still writes one directly.
--   * It adds no reservation column, no reservation movement type and no reserved-quantity
--     anywhere. `OrderStatus.RESERVED` exists in the enum because the approved lifecycle
--     names it, and no transition can reach it — nothing in this system accounts for
--     reserved stock, so an order claiming RESERVED would be claiming something untrue.
--   * It adds no payment table, status or amount. Payment remains a separate axis and
--     remains outside this phase entirely.
--   * `stores.nextOrderSeq` is a second counter beside `nextBillSeq`, not a replacement:
--     orders and bills are different documents and must not share a sequence.

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'RESERVED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderAddressType" AS ENUM ('BILLING', 'SHIPPING');

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "nextOrderSeq" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "customerId" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL,
    "subtotalMinor" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "uomId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "fulfilledQuantity" INTEGER NOT NULL DEFAULT 0,
    "unitPriceMinor" INTEGER NOT NULL,
    "lineTotalMinor" INTEGER NOT NULL,
    "priceSourceSnapshot" TEXT,
    "priceListIdSnapshot" TEXT,
    "skuSnapshot" TEXT NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "uomCodeSnapshot" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_addresses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "OrderAddressType" NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "sourceAddressId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "orders_tenantId_createdAt_idx" ON "orders"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "orders_tenantId_status_idx" ON "orders"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenantId_idempotencyKey_key" ON "orders"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "orders_storeId_orderNumber_key" ON "orders"("storeId", "orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "orders_id_tenantId_key" ON "orders"("id", "tenantId");

-- CreateIndex
CREATE INDEX "order_items_tenantId_orderId_idx" ON "order_items"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "order_items_variantId_idx" ON "order_items"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_orderId_variantId_uomId_key" ON "order_items"("orderId", "variantId", "uomId");

-- CreateIndex
CREATE INDEX "order_addresses_tenantId_orderId_idx" ON "order_addresses"("tenantId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "order_addresses_orderId_type_key" ON "order_addresses"("orderId", "type");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_storeId_tenantId_fkey" FOREIGN KEY ("storeId", "tenantId") REFERENCES "stores"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "customers"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_tenantId_fkey" FOREIGN KEY ("orderId", "tenantId") REFERENCES "orders"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variantId_tenantId_fkey" FOREIGN KEY ("variantId", "tenantId") REFERENCES "product_variants"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_uomId_tenantId_fkey" FOREIGN KEY ("uomId", "tenantId") REFERENCES "uoms"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_addresses" ADD CONSTRAINT "order_addresses_orderId_tenantId_fkey" FOREIGN KEY ("orderId", "tenantId") REFERENCES "orders"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_addresses" ADD CONSTRAINT "order_addresses_sourceAddressId_tenantId_fkey" FOREIGN KEY ("sourceAddressId", "tenantId") REFERENCES "addresses"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

