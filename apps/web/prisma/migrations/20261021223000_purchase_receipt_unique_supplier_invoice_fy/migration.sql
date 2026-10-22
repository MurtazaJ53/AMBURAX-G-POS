-- Migration: Add get_financial_year_ist and purchase_receipt_unique_supplier_invoice_fy unique index

-- Step 1: Create IMMUTABLE function for Indian Financial Year (April 1 - March 31 in IST)
CREATE OR REPLACE FUNCTION get_financial_year_ist(dt timestamp without time zone)
RETURNS integer AS $$
  SELECT CASE 
    WHEN EXTRACT(MONTH FROM (dt + interval '5 hours 30 minutes')) >= 4 
      THEN EXTRACT(YEAR FROM (dt + interval '5 hours 30 minutes'))::integer
    ELSE (EXTRACT(YEAR FROM (dt + interval '5 hours 30 minutes')) - 1)::integer
  END;
$$ LANGUAGE sql IMMUTABLE;

-- Step 2: Pre-check assertion using get_financial_year_ist and norm_inv
DO $$
DECLARE
  dup_count integer;
  dup_details text;
BEGIN
  SELECT COUNT(*), COALESCE(string_agg('Tenant: ' || "tenantId" || ', Supplier: ' || "supplierId" || ', Invoice: ' || norm_inv || ', FY: ' || fy, '; '), '')
  INTO dup_count, dup_details
  FROM (
    SELECT "tenantId", "supplierId", normalize_product_key("supplierInvoiceNo") AS norm_inv,
           get_financial_year_ist(COALESCE("supplierInvoiceDate", "createdAt")) AS fy
    FROM "purchase_receipts"
    WHERE "supplierInvoiceNo" IS NOT NULL AND TRIM("supplierInvoiceNo") != ''
      AND "supplierId" IS NOT NULL
    GROUP BY "tenantId", "supplierId", normalize_product_key("supplierInvoiceNo"),
             get_financial_year_ist(COALESCE("supplierInvoiceDate", "createdAt"))
    HAVING COUNT(*) > 1
  ) dups;

  IF dup_count > 0 THEN
    RAISE EXCEPTION 'Cannot apply unique index: found % duplicate invoice group(s): %', dup_count, dup_details;
  END IF;
END $$;

-- Step 3: Create partial UNIQUE index
CREATE UNIQUE INDEX IF NOT EXISTS purchase_receipt_unique_supplier_invoice_fy
ON purchase_receipts (
  "tenantId",
  "supplierId",
  normalize_product_key("supplierInvoiceNo"),
  get_financial_year_ist(COALESCE("supplierInvoiceDate", "createdAt"))
)
WHERE "supplierInvoiceNo" IS NOT NULL AND TRIM("supplierInvoiceNo") != ''
  AND "supplierId" IS NOT NULL;
