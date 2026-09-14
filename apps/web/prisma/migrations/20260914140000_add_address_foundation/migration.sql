-- Addresses: a tenant-owned postal address, a real join to the customer that owns it, and a
-- GSTIN for customers who buy as a business.
--
-- Entirely additive. Three nullable columns on `customers` and two new tables — no backfill, no
-- data rewritten, nothing existing made required. Every customer that exists today keeps
-- working with no address and no GSTIN, which is the correct state for a walk-in retail
-- customer and always will be.
--
-- Two things this migration deliberately does NOT do:
--
--   * It does not touch `stores.addressLine` / `city` / `state` / `postalCode` / `phone`. Store
--     addresses stay inline. Migrating them is a change to onboarding, and onboarding is not
--     this phase's to change.
--   * It does not add an `isDefault` flag to an address. Default selection lives on the
--     customer as two nullable pointers, so "two conflicting default billing addresses" is not
--     a state the database can represent. The alternative — a partial unique index over a flag
--     — is something Prisma cannot express without permanent schema drift.

-- CreateEnum
CREATE TYPE "AddressType" AS ENUM ('BILLING', 'SHIPPING', 'BOTH');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "defaultBillingAddressId" TEXT,
ADD COLUMN     "defaultShippingAddressId" TEXT,
ADD COLUMN     "gstin" TEXT;

-- CreateTable
CREATE TABLE "addresses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "type" "AddressType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_addresses" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "addressId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "addresses_tenantId_idx" ON "addresses"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "addresses_id_tenantId_key" ON "addresses"("id", "tenantId");

-- CreateIndex
CREATE INDEX "customer_addresses_tenantId_customerId_idx" ON "customer_addresses"("tenantId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_addresses_customerId_addressId_key" ON "customer_addresses"("customerId", "addressId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_id_tenantId_key" ON "customers"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_defaultBillingAddressId_tenantId_fkey" FOREIGN KEY ("defaultBillingAddressId", "tenantId") REFERENCES "addresses"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_defaultShippingAddressId_tenantId_fkey" FOREIGN KEY ("defaultShippingAddressId", "tenantId") REFERENCES "addresses"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_customerId_tenantId_fkey" FOREIGN KEY ("customerId", "tenantId") REFERENCES "customers"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_addresses" ADD CONSTRAINT "customer_addresses_addressId_tenantId_fkey" FOREIGN KEY ("addressId", "tenantId") REFERENCES "addresses"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

