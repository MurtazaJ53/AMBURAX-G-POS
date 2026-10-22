-- AlterTable Product
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "hsnCode" TEXT;

-- AlterTable ProductVariant
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "minPriceMinor" INTEGER;
