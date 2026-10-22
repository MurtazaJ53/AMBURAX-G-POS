-- Enforce Invariant I-4: Unique composite constraints for tenant isolation
ALTER TABLE "attribute_definitions" ADD CONSTRAINT "attribute_definitions_id_tenantId_key" UNIQUE ("id", "tenantId");
ALTER TABLE "attribute_values" ADD CONSTRAINT "attribute_values_id_tenantId_key" UNIQUE ("id", "tenantId");
ALTER TABLE "size_groups" ADD CONSTRAINT "size_groups_id_tenantId_key" UNIQUE ("id", "tenantId");

-- Update foreign keys to composite [id, tenantId] (invariant I-4)
-- 1. attribute_values -> attribute_definitions
ALTER TABLE "attribute_values" DROP CONSTRAINT IF EXISTS "attribute_values_definitionId_fkey";
ALTER TABLE "attribute_values" DROP CONSTRAINT IF EXISTS "attribute_values_definitionId_tenantId_fkey";
ALTER TABLE "attribute_values" ADD CONSTRAINT "attribute_values_definitionId_tenantId_fkey"
  FOREIGN KEY ("definitionId", "tenantId") REFERENCES "attribute_definitions"("id", "tenantId") ON DELETE CASCADE;

-- 2. size_group_items -> size_groups & attribute_values
ALTER TABLE "size_group_items" DROP CONSTRAINT IF EXISTS "size_group_items_sizeGroupId_fkey";
ALTER TABLE "size_group_items" DROP CONSTRAINT IF EXISTS "size_group_items_sizeGroupId_tenantId_fkey";
ALTER TABLE "size_group_items" ADD CONSTRAINT "size_group_items_sizeGroupId_tenantId_fkey"
  FOREIGN KEY ("sizeGroupId", "tenantId") REFERENCES "size_groups"("id", "tenantId") ON DELETE CASCADE;

ALTER TABLE "size_group_items" DROP CONSTRAINT IF EXISTS "size_group_items_attributeValueId_fkey";
ALTER TABLE "size_group_items" DROP CONSTRAINT IF EXISTS "size_group_items_attributeValueId_tenantId_fkey";
ALTER TABLE "size_group_items" ADD CONSTRAINT "size_group_items_attributeValueId_tenantId_fkey"
  FOREIGN KEY ("attributeValueId", "tenantId") REFERENCES "attribute_values"("id", "tenantId") ON DELETE CASCADE;

-- 3. variant_attribute_values -> product_variants, attribute_definitions, attribute_values
ALTER TABLE "variant_attribute_values" DROP CONSTRAINT IF EXISTS "variant_attribute_values_variantId_fkey";
ALTER TABLE "variant_attribute_values" DROP CONSTRAINT IF EXISTS "variant_attribute_values_variantId_tenantId_fkey";
ALTER TABLE "variant_attribute_values" ADD CONSTRAINT "variant_attribute_values_variantId_tenantId_fkey"
  FOREIGN KEY ("variantId", "tenantId") REFERENCES "product_variants"("id", "tenantId") ON DELETE CASCADE;

ALTER TABLE "variant_attribute_values" DROP CONSTRAINT IF EXISTS "variant_attribute_values_attributeDefinitionId_fkey";
ALTER TABLE "variant_attribute_values" DROP CONSTRAINT IF EXISTS "variant_attribute_values_attributeDefinitionId_tenantId_fkey";
ALTER TABLE "variant_attribute_values" ADD CONSTRAINT "variant_attribute_values_attributeDefinitionId_tenantId_fkey"
  FOREIGN KEY ("attributeDefinitionId", "tenantId") REFERENCES "attribute_definitions"("id", "tenantId") ON DELETE RESTRICT;

ALTER TABLE "variant_attribute_values" DROP CONSTRAINT IF EXISTS "variant_attribute_values_attributeValueId_fkey";
ALTER TABLE "variant_attribute_values" DROP CONSTRAINT IF EXISTS "variant_attribute_values_attributeValueId_tenantId_fkey";
ALTER TABLE "variant_attribute_values" ADD CONSTRAINT "variant_attribute_values_attributeValueId_tenantId_fkey"
  FOREIGN KEY ("attributeValueId", "tenantId") REFERENCES "attribute_values"("id", "tenantId") ON DELETE RESTRICT;

-- 4. variant_barcodes -> product_variants
ALTER TABLE "variant_barcodes" DROP CONSTRAINT IF EXISTS "variant_barcodes_variantId_fkey";
ALTER TABLE "variant_barcodes" DROP CONSTRAINT IF EXISTS "variant_barcodes_variantId_tenantId_fkey";
ALTER TABLE "variant_barcodes" ADD CONSTRAINT "variant_barcodes_variantId_tenantId_fkey"
  FOREIGN KEY ("variantId", "tenantId") REFERENCES "product_variants"("id", "tenantId") ON DELETE CASCADE;
