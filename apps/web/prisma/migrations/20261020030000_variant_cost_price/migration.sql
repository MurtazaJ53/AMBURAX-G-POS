-- Optional purchase cost on a variant (entered on the product form; used for margin).
ALTER TABLE "product_variants" ADD COLUMN "costPriceMinor" INTEGER;
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_costPriceMinor_check" CHECK ("costPriceMinor" IS NULL OR "costPriceMinor" >= 0);
