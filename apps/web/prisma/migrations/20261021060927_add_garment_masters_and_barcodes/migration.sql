-- CreateEnum
CREATE TYPE "BarcodeType" AS ENUM ('INTERNAL', 'MANUFACTURER', 'EAN13', 'UPC', 'QR');

-- CreateTable
CREATE TABLE "attribute_definitions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isMandatory" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attribute_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attribute_values" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "colorHex" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attribute_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "size_groups" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "size_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "size_group_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sizeGroupId" TEXT NOT NULL,
    "attributeValueId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "size_group_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variant_attribute_values" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "attributeDefinitionId" TEXT NOT NULL,
    "attributeValueId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variant_attribute_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variant_barcodes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "type" "BarcodeType" NOT NULL DEFAULT 'INTERNAL',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "variant_barcodes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attribute_definitions_tenantId_sortOrder_idx" ON "attribute_definitions"("tenantId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "attribute_definitions_tenantId_code_key" ON "attribute_definitions"("tenantId", "code");

-- CreateIndex
CREATE INDEX "attribute_values_tenantId_definitionId_sortOrder_idx" ON "attribute_values"("tenantId", "definitionId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "attribute_values_tenantId_definitionId_code_key" ON "attribute_values"("tenantId", "definitionId", "code");

-- CreateIndex
CREATE INDEX "size_groups_tenantId_sortOrder_idx" ON "size_groups"("tenantId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "size_groups_tenantId_code_key" ON "size_groups"("tenantId", "code");

-- CreateIndex
CREATE INDEX "size_group_items_tenantId_sizeGroupId_sortOrder_idx" ON "size_group_items"("tenantId", "sizeGroupId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "size_group_items_sizeGroupId_attributeValueId_key" ON "size_group_items"("sizeGroupId", "attributeValueId");

-- CreateIndex
CREATE INDEX "variant_attribute_values_tenantId_attributeValueId_idx" ON "variant_attribute_values"("tenantId", "attributeValueId");

-- CreateIndex
CREATE UNIQUE INDEX "variant_attribute_values_variantId_attributeDefinitionId_key" ON "variant_attribute_values"("variantId", "attributeDefinitionId");

-- CreateIndex
CREATE INDEX "variant_barcodes_tenantId_variantId_idx" ON "variant_barcodes"("tenantId", "variantId");

-- CreateIndex
CREATE UNIQUE INDEX "variant_barcodes_tenantId_barcode_key" ON "variant_barcodes"("tenantId", "barcode");

-- AddForeignKey
ALTER TABLE "attribute_definitions" ADD CONSTRAINT "attribute_definitions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribute_values" ADD CONSTRAINT "attribute_values_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attribute_values" ADD CONSTRAINT "attribute_values_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "attribute_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "size_groups" ADD CONSTRAINT "size_groups_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "size_group_items" ADD CONSTRAINT "size_group_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "size_group_items" ADD CONSTRAINT "size_group_items_sizeGroupId_fkey" FOREIGN KEY ("sizeGroupId") REFERENCES "size_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "size_group_items" ADD CONSTRAINT "size_group_items_attributeValueId_fkey" FOREIGN KEY ("attributeValueId") REFERENCES "attribute_values"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_attribute_values" ADD CONSTRAINT "variant_attribute_values_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_attribute_values" ADD CONSTRAINT "variant_attribute_values_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_attribute_values" ADD CONSTRAINT "variant_attribute_values_attributeDefinitionId_fkey" FOREIGN KEY ("attributeDefinitionId") REFERENCES "attribute_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_attribute_values" ADD CONSTRAINT "variant_attribute_values_attributeValueId_fkey" FOREIGN KEY ("attributeValueId") REFERENCES "attribute_values"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_barcodes" ADD CONSTRAINT "variant_barcodes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variant_barcodes" ADD CONSTRAINT "variant_barcodes_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ==============================================================================
-- CUSTOM MIGRATION EXTENSION (To append to Prisma-generated migration.sql)
-- ==============================================================================

-- 1. Partial Unique Index: Exactly one primary barcode per variant
CREATE UNIQUE INDEX IF NOT EXISTS "one_primary_barcode_per_variant" 
ON "variant_barcodes"("variantId") WHERE "isPrimary" = true;

-- 2. Helper Normalization Function (Immutable)
CREATE OR REPLACE FUNCTION _amb_normalize_code(val TEXT) RETURNS TEXT AS $$
DECLARE
    cleaned TEXT;
BEGIN
    IF val IS NULL THEN RETURN NULL; END IF;
    cleaned := trim(both '_' from regexp_replace(upper(trim(val)), '[^A-Z0-9]+', '_', 'g'));
    IF cleaned = '' THEN RETURN NULL; END IF;
    RETURN cleaned;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 3. Insert System Definitions ('SIZE' & 'COLOUR') for all existing tenants
INSERT INTO "attribute_definitions" ("id", "tenantId", "name", "code", "sortOrder", "isSystem", "updatedAt")
SELECT 
    'def_sz_' || t.id,
    t.id,
    'Size',
    'SIZE',
    1,
    true,
    now()
FROM "tenants" t
ON CONFLICT ("tenantId", "code") DO NOTHING;

INSERT INTO "attribute_definitions" ("id", "tenantId", "name", "code", "sortOrder", "isSystem", "updatedAt")
SELECT 
    'def_clr_' || t.id,
    t.id,
    'Colour',
    'COLOUR',
    2,
    true,
    now()
FROM "tenants" t
ON CONFLICT ("tenantId", "code") DO NOTHING;

-- 4. Set-Based Backfill: Distinct SIZES into attribute_values
-- Picks the most frequently used human spelling as canonical display value
WITH size_candidates AS (
    SELECT 
        v."tenantId",
        d.id AS "definitionId",
        _amb_normalize_code(v.size) AS norm_code,
        trim(v.size) AS display_val,
        count(*) AS freq
    FROM "product_variants" v
    JOIN "attribute_definitions" d ON d."tenantId" = v."tenantId" AND d.code = 'SIZE'
    WHERE v.size IS NOT NULL AND _amb_normalize_code(v.size) IS NOT NULL
    GROUP BY v."tenantId", d.id, _amb_normalize_code(v.size), trim(v.size)
),
best_size AS (
    SELECT DISTINCT ON ("definitionId", norm_code)
        "tenantId",
        "definitionId",
        norm_code,
        display_val
    FROM size_candidates
    ORDER BY "definitionId", norm_code, freq DESC, display_val ASC
)
INSERT INTO "attribute_values" ("id", "tenantId", "definitionId", "value", "code", "sortOrder", "isActive", "updatedAt")
SELECT 
    'val_sz_' || md5("definitionId" || '_' || norm_code),
    "tenantId",
    "definitionId",
    display_val,
    norm_code,
    0,
    true,
    now()
FROM best_size
ON CONFLICT ("tenantId", "definitionId", "code") DO NOTHING;

-- 5. Set-Based Backfill: Distinct COLOURS into attribute_values
-- Picks the most frequently used human spelling as canonical display value
WITH colour_candidates AS (
    SELECT 
        v."tenantId",
        d.id AS "definitionId",
        _amb_normalize_code(v.colour) AS norm_code,
        trim(v.colour) AS display_val,
        count(*) AS freq
    FROM "product_variants" v
    JOIN "attribute_definitions" d ON d."tenantId" = v."tenantId" AND d.code = 'COLOUR'
    WHERE v.colour IS NOT NULL AND _amb_normalize_code(v.colour) IS NOT NULL
    GROUP BY v."tenantId", d.id, _amb_normalize_code(v.colour), trim(v.colour)
),
best_colour AS (
    SELECT DISTINCT ON ("definitionId", norm_code)
        "tenantId",
        "definitionId",
        norm_code,
        display_val
    FROM colour_candidates
    ORDER BY "definitionId", norm_code, freq DESC, display_val ASC
)
INSERT INTO "attribute_values" ("id", "tenantId", "definitionId", "value", "code", "sortOrder", "isActive", "updatedAt")
SELECT 
    'val_clr_' || md5("definitionId" || '_' || norm_code),
    "tenantId",
    "definitionId",
    display_val,
    norm_code,
    0,
    true,
    now()
FROM best_colour
ON CONFLICT ("tenantId", "definitionId", "code") DO NOTHING;

-- 6. Set-Based Link: Connect Variants to Size Attribute Values
INSERT INTO "variant_attribute_values" ("id", "tenantId", "variantId", "attributeDefinitionId", "attributeValueId")
SELECT 
    'vav_sz_' || md5(v.id || '_' || d.id),
    v."tenantId",
    v.id,
    d.id,
    av.id
FROM "product_variants" v
JOIN "attribute_definitions" d ON d."tenantId" = v."tenantId" AND d.code = 'SIZE'
JOIN "attribute_values" av ON av."definitionId" = d.id AND av.code = _amb_normalize_code(v.size)
WHERE v.size IS NOT NULL AND _amb_normalize_code(v.size) IS NOT NULL
ON CONFLICT ("variantId", "attributeDefinitionId") DO NOTHING;

-- 7. Set-Based Link: Connect Variants to Colour Attribute Values
INSERT INTO "variant_attribute_values" ("id", "tenantId", "variantId", "attributeDefinitionId", "attributeValueId")
SELECT 
    'vav_clr_' || md5(v.id || '_' || d.id),
    v."tenantId",
    v.id,
    d.id,
    av.id
FROM "product_variants" v
JOIN "attribute_definitions" d ON d."tenantId" = v."tenantId" AND d.code = 'COLOUR'
JOIN "attribute_values" av ON av."definitionId" = d.id AND av.code = _amb_normalize_code(v.colour)
WHERE v.colour IS NOT NULL AND _amb_normalize_code(v.colour) IS NOT NULL
ON CONFLICT ("variantId", "attributeDefinitionId") DO NOTHING;

-- 8. Set-Based Barcode Backfill (Deterministic Primary Selection)
-- Uses DISTINCT ON (tenantId, barcode) ordered by createdAt ASC, id ASC to deterministically pick the winning variant
WITH ordered_barcodes AS (
    SELECT DISTINCT ON (v."tenantId", trim(v.barcode))
        v."tenantId",
        v.id AS variant_id,
        trim(v.barcode) AS clean_bc,
        v."createdAt"
    FROM "product_variants" v
    WHERE coalesce(trim(v.barcode), '') <> ''
    ORDER BY v."tenantId", trim(v.barcode), v."createdAt" ASC, v.id ASC
)
INSERT INTO "variant_barcodes" ("id", "tenantId", "variantId", "barcode", "type", "isPrimary", "updatedAt")
SELECT 
    'vb_' || md5(ob.variant_id || '_' || ob.clean_bc),
    ob."tenantId",
    ob.variant_id,
    ob.clean_bc,
    'INTERNAL'::"BarcodeType",
    true,
    now()
FROM ordered_barcodes ob
WHERE NOT EXISTS (
    SELECT 1 FROM "variant_barcodes" b 
    WHERE b."variantId" = ob.variant_id AND b."isPrimary" = true
)
ON CONFLICT ("tenantId", "barcode") DO NOTHING;

-- 9. Clean up helper function
DROP FUNCTION IF EXISTS _amb_normalize_code(TEXT);

