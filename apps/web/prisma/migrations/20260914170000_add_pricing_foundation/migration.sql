-- Pricing: a named list of prices per tenant, quantity breaks as rows, and three nullable
-- pointers at a list — customer, store, and the tenant's own default.
--
-- Entirely additive. Two new tables and three nullable columns; no backfill, nothing rewritten,
-- nothing made required. Every tenant that exists today has no price list, every store sells at
-- ProductVariant.priceMinor exactly as before, and the POS path is untouched.
--
-- Three things this migration deliberately does NOT do:
--
--   * It does not create a default price list for anyone. A tenant with no list is not broken —
--     it is the ordinary state, and resolution falls through to the variant's base price.
--   * It does not add an isDefault flag to price_lists. The tenant default is a pointer on
--     tenants, so "two tenant defaults" is not a state the database can represent. A partial
--     unique index over a flag is the alternative, and Prisma cannot express one without
--     permanent drift.
--   * It does not touch ProductVariant.priceMinor, sale_items, or anything the POS reads.
--     Pricing resolution is a new service; wiring it into checkout belongs to the Order phase.

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "priceListId" TEXT;

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "priceListId" TEXT;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "defaultPriceListId" TEXT;

-- CreateTable
CREATE TABLE "price_lists" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_list_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "uomId" TEXT NOT NULL,
    "minQuantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceMinor" INTEGER NOT NULL,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_lists_tenantId_idx" ON "price_lists"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "price_lists_tenantId_name_key" ON "price_lists"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "price_lists_id_tenantId_key" ON "price_lists"("id", "tenantId");

-- CreateIndex
CREATE INDEX "price_list_items_tenantId_variantId_idx" ON "price_list_items"("tenantId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "price_list_items_priceListId_variantId_uomId_minQuantity_key" ON "price_list_items"("priceListId", "variantId", "uomId", "minQuantity");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_defaultPriceListId_id_fkey" FOREIGN KEY ("defaultPriceListId", "id") REFERENCES "price_lists"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_priceListId_tenantId_fkey" FOREIGN KEY ("priceListId", "tenantId") REFERENCES "price_lists"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_priceListId_tenantId_fkey" FOREIGN KEY ("priceListId", "tenantId") REFERENCES "price_lists"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_priceListId_tenantId_fkey" FOREIGN KEY ("priceListId", "tenantId") REFERENCES "price_lists"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_variantId_tenantId_fkey" FOREIGN KEY ("variantId", "tenantId") REFERENCES "product_variants"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_uomId_tenantId_fkey" FOREIGN KEY ("uomId", "tenantId") REFERENCES "uoms"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

