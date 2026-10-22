-- Migration: Add normalize_product_key function and unique index on products (tenantId, normalized name, normalized brand)

-- 1. Create IMMUTABLE function for uniform SQL-level normalization
CREATE OR REPLACE FUNCTION normalize_product_key(raw_text text)
RETURNS text AS $$
  SELECT regexp_replace(lower(trim(COALESCE(raw_text, ''))), '[^a-z0-9]', '', 'g');
$$ LANGUAGE sql IMMUTABLE;

-- 2. Create UNIQUE index across tenantId, normalized name, and normalized brand
-- Treats NULL and placeholder 'all' as empty string. Covers archived and active products.
CREATE UNIQUE INDEX IF NOT EXISTS product_unique_name_brand 
ON products (
  "tenantId", 
  normalize_product_key("name"), 
  normalize_product_key(
    CASE 
      WHEN lower(trim(COALESCE("brand", ''))) = 'all' THEN '' 
      ELSE COALESCE("brand", '') 
    END
  )
);
