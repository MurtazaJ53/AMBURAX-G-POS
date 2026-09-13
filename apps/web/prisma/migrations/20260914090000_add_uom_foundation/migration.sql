-- Unit of measure: a tenant-scoped catalogue of units, exact integer conversions between them,
-- and a base unit per product.
--
-- Nothing about how quantities are STORED changes here. SaleItem.quantity, StockLevel.quantity
-- and StockMovement.quantityDelta remain INTEGER, in the product's base unit, exactly as
-- before. This migration adds the vocabulary a garment business needs to say "a carton holds 24
-- pieces"; converting at the edges is what later phases consume.
--
-- The backfill at the end is the part worth reading. Every product in this system has always
-- been counted in pieces — integer quantities, MAX_LINE_QUANTITY, a POS that sells garments one
-- at a time — so PCS is not a guess, it is the unit the data was already using. Giving each
-- tenant exactly one PCS row and pointing its products at it records what was already true,
-- rather than inventing something new.

-- CreateTable
CREATE TABLE "uoms" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "decimalPlaces" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uoms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uom_conversions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fromUomId" TEXT NOT NULL,
    "toUomId" TEXT NOT NULL,
    "factor" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "uom_conversions_pkey" PRIMARY KEY ("id")
);

-- AlterTable
-- Nullable: products existed before units did, and a product created before its tenant has
-- defined any unit is still a valid product.
ALTER TABLE "products" ADD COLUMN "baseUomId" TEXT;

-- CreateIndex
CREATE INDEX "uoms_tenantId_idx" ON "uoms"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "uoms_tenantId_code_key" ON "uoms"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "uoms_id_tenantId_key" ON "uoms"("id", "tenantId");

-- CreateIndex
CREATE INDEX "uom_conversions_tenantId_toUomId_idx" ON "uom_conversions"("tenantId", "toUomId");

-- CreateIndex
-- The database's guarantee against duplicate definitions: one conversion per ordered pair per
-- tenant. Two concurrent creates of the same pair cannot both succeed, so the service does not
-- rely on a check-then-insert.
CREATE UNIQUE INDEX "uom_conversions_tenantId_fromUomId_toUomId_key" ON "uom_conversions"("tenantId", "fromUomId", "toUomId");

-- CreateIndex
CREATE UNIQUE INDEX "products_id_tenantId_key" ON "products"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "uoms" ADD CONSTRAINT "uoms_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uom_conversions" ADD CONSTRAINT "uom_conversions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- Composite throughout (invariant I-4): a conversion's units and a product's base unit must
-- belong to the tenant that owns the row, enforced by PostgreSQL rather than by convention.
ALTER TABLE "uom_conversions" ADD CONSTRAINT "uom_conversions_fromUomId_tenantId_fkey" FOREIGN KEY ("fromUomId", "tenantId") REFERENCES "uoms"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uom_conversions" ADD CONSTRAINT "uom_conversions_toUomId_tenantId_fkey" FOREIGN KEY ("toUomId", "tenantId") REFERENCES "uoms"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_baseUomId_tenantId_fkey" FOREIGN KEY ("baseUomId", "tenantId") REFERENCES "uoms"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------
-- Default PCS per tenant, and the backfill that points existing products at it
-- ---------------------------------------------------------------------------------------
-- Deterministic id: 'uom_pcs_' || tenantId. Re-running this statement cannot create a second
-- PCS for a tenant — the primary key collides — and the (tenantId, code) unique index says the
-- same thing from the other direction. One PCS per tenant, decided here rather than by whichever
-- request happens to arrive first.
--
-- Only tenants that exist get a row. On an empty database this inserts nothing, which is the
-- correct behaviour rather than a special case.
INSERT INTO "uoms" ("id", "tenantId", "code", "name", "decimalPlaces", "isActive", "createdAt", "updatedAt")
SELECT
  'uom_pcs_' || t."id",
  t."id",
  'PCS',
  'Pieces',
  0,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "tenants" t
ON CONFLICT ("tenantId", "code") DO NOTHING;

-- Every existing product was already counted in pieces; this records that fact. Scoped by
-- tenant on both sides, so a product can only be pointed at its own tenant's PCS — the composite
-- foreign key above would reject anything else anyway.
UPDATE "products" p
   SET "baseUomId" = u."id"
  FROM "uoms" u
 WHERE u."tenantId" = p."tenantId"
   AND u."code" = 'PCS'
   AND p."baseUomId" IS NULL;

-- Verify the backfill before committing: every product whose tenant has a PCS unit must now
-- carry a base unit, and no product may point at another tenant's unit. Checking here means the
-- invariant is true before any application code depends on it.
DO $$
DECLARE
  unassigned_count integer;
  foreign_count    integer;
BEGIN
  SELECT count(*) INTO unassigned_count
    FROM "products" p
   WHERE p."baseUomId" IS NULL
     AND EXISTS (SELECT 1 FROM "uoms" u WHERE u."tenantId" = p."tenantId" AND u."code" = 'PCS');

  IF unassigned_count > 0 THEN
    RAISE EXCEPTION
      'UOM backfill incomplete: % product(s) still have no base unit despite their tenant having PCS. Rolling back.',
      unassigned_count;
  END IF;

  SELECT count(*) INTO foreign_count
    FROM "products" p
    JOIN "uoms" u ON u."id" = p."baseUomId"
   WHERE u."tenantId" <> p."tenantId";

  IF foreign_count > 0 THEN
    RAISE EXCEPTION
      'UOM backfill attributed % product(s) to another tenant''s unit. Rolling back.',
      foreign_count;
  END IF;
END $$;
