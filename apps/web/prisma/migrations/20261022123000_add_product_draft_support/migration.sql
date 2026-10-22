-- Migration: add_product_draft_support
-- Purpose: Adds draft tracking columns to products table so quick-created bill items do not pollute POS or ERPNext until bill save.
-- Non-breaking: defaults isDraft to false for all existing products.

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "isDraft" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "draftExpiresAt" TIMESTAMP(3);

-- Create partial index to quickly locate active drafts by tenant
CREATE INDEX IF NOT EXISTS "products_tenant_draft_idx" ON "products" ("tenantId", "isDraft") WHERE ("isDraft" = true);
