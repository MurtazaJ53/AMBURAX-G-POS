CREATE TYPE "GstTaxTreatment" AS ENUM (
    'TAXABLE',
    'EXEMPT',
    'NIL_RATED',
    'ZERO_RATED',
    'NON_GST',
    'UNSPECIFIED'
);

ALTER TABLE "product_variants"
    ADD COLUMN "taxTreatment" "GstTaxTreatment" NOT NULL DEFAULT 'UNSPECIFIED',
    ADD COLUMN "taxExemptionRef" TEXT;

-- A positive configured rate is sufficient to preserve the existing taxable-rate behavior.
-- A zero rate is ambiguous and must be explicitly classified by an authorized catalog editor.
UPDATE "product_variants"
SET "taxTreatment" = 'TAXABLE'
WHERE "taxRateBp" > 0;
