-- Bill discounts and the garment GST slab (owner decisions 2026-10-13).
-- Additive: existing sales have no discount, and existing variants stay FIXED rate.

ALTER TABLE "sales" ADD COLUMN "discountReason" TEXT;
ALTER TABLE "sales" ADD COLUMN "discountAuthorisedByUserId" TEXT;

-- A discounted bill always says why and who authorised it.
ALTER TABLE "sales" ADD CONSTRAINT "sales_discount_reason_check"
  CHECK ("discountMinor" = 0 OR ("discountReason" IS NOT NULL AND "discountAuthorisedByUserId" IS NOT NULL));

CREATE TYPE "TaxRateMode" AS ENUM ('FIXED', 'APPAREL_SLAB');
ALTER TABLE "product_variants" ADD COLUMN "taxRateMode" "TaxRateMode" NOT NULL DEFAULT 'FIXED';

CREATE TABLE "tenant_tax_settings" (
    "tenantId" TEXT NOT NULL,
    "apparelThresholdMinor" INTEGER NOT NULL DEFAULT 250000,
    "apparelLowRateBp" INTEGER NOT NULL DEFAULT 500,
    "apparelHighRateBp" INTEGER NOT NULL DEFAULT 1800,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByUserId" TEXT,
    CONSTRAINT "tenant_tax_settings_pkey" PRIMARY KEY ("tenantId"),
    CONSTRAINT "fk_tax_setting_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "tenant_tax_settings_values_check" CHECK (
      "apparelThresholdMinor" > 0 AND "apparelLowRateBp" > 0 AND "apparelHighRateBp" >= "apparelLowRateBp"
      AND "apparelHighRateBp" <= 10000
    )
);
