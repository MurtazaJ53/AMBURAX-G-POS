-- ProductVariant.erpSyncStatus was added to schema.prisma with the ERP item master sync
-- (commit 554b2b4) and is written by ErpCatalogAdapter, but no migration created the column.
-- The "ErpSyncStatus" enum already exists (20260912175609_add_retail_commerce_domain).
-- IF NOT EXISTS keeps this additive for any database whose column was created out of band.
ALTER TABLE "product_variants"
    ADD COLUMN IF NOT EXISTS "erpSyncStatus" "ErpSyncStatus" NOT NULL DEFAULT 'PENDING';
