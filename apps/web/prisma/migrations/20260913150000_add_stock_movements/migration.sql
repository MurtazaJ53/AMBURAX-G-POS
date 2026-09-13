-- Establish the inventory movement ledger, and give every existing balance a history.
--
-- Before this migration, `stock_levels.quantity` was a bare number with exactly one writer
-- in the whole codebase: the decrement inside `createSale`. Stock could fall and never rise,
-- and no row recorded who changed a balance, when, why, or from what. This adds the ledger
-- that explains it, and backfills the balances that already exist so the projection is
-- consistent from the first second the table exists rather than from the next movement.
--
-- The backfill is the interesting half. It is written to fail loudly rather than to paper
-- over disagreement, and it verifies its own result before the transaction commits.

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('OPENING_BALANCE', 'RECEIPT', 'SALE', 'ADJUSTMENT', 'STOCK_TAKE');

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantityDelta" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "reason" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "actorUserId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_movements_tenantId_storeId_variantId_occurredAt_idx" ON "stock_movements"("tenantId", "storeId", "variantId", "occurredAt");

-- CreateIndex
CREATE INDEX "stock_movements_referenceType_referenceId_idx" ON "stock_movements"("referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_tenantId_idempotencyKey_key" ON "stock_movements"("tenantId", "idempotencyKey");

-- CreateIndex
-- The referencable half of stock_movements' composite foreign key. Redundant as a
-- uniqueness rule (id is already the primary key); it exists so PostgreSQL accepts
-- (id, tenantId) as a foreign-key target, exactly as users and stores already do.
CREATE UNIQUE INDEX "product_variants_id_tenantId_key" ON "product_variants"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- Composite from the start (invariant I-4): a movement's store and variant must both belong
-- to the tenant the movement claims, enforced by PostgreSQL rather than by convention.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_storeId_tenantId_fkey" FOREIGN KEY ("storeId", "tenantId") REFERENCES "stores"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variantId_tenantId_fkey" FOREIGN KEY ("variantId", "tenantId") REFERENCES "product_variants"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------
-- Opening-balance backfill
-- ---------------------------------------------------------------------------------------
-- Every existing non-zero balance becomes one OPENING_BALANCE movement, so the ledger
-- explains the balance instead of contradicting it. A zero balance needs no movement: the
-- sum of an empty set is already zero, and writing a zero-delta row would add noise to every
-- future ledger read for no information.
--
-- `tenantId` is taken from the STORE, not from `stock_levels.tenantId`. That column has no
-- foreign key of its own (a known P2 gap, invariant I-4), so it is the one value here that
-- nothing has ever verified; the store's tenant is FK-enforced and therefore trustworthy.
INSERT INTO "stock_movements" (
  "id", "tenantId", "storeId", "variantId", "type",
  "quantityDelta", "balanceAfter", "reason", "idempotencyKey", "occurredAt", "createdAt"
)
SELECT
  'opening_' || sl."id",
  s."tenantId",
  sl."storeId",
  sl."variantId",
  'OPENING_BALANCE',
  sl."quantity",
  sl."quantity",
  'Balance carried forward when the inventory ledger was introduced.',
  'OPENING_BALANCE:' || sl."id",
  COALESCE(sl."updatedAt", CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
FROM "stock_levels" sl
JOIN "stores" s ON s."id" = sl."storeId"
JOIN "product_variants" v ON v."id" = sl."variantId"
WHERE sl."quantity" <> 0
  AND v."tenantId" = s."tenantId";

-- Refuse to continue if any non-zero balance could not be attributed. A stock level whose
-- store and variant disagree about their tenant is corrupt data, not a migration problem to
-- solve by guessing which side is right — and inventing an attribution would launder it.
DO $$
DECLARE
  orphan_count integer;
  orphan_ids   text;
BEGIN
  SELECT count(*) INTO orphan_count
    FROM "stock_levels" sl
   WHERE sl."quantity" <> 0
     AND NOT EXISTS (
       SELECT 1 FROM "stock_movements" m WHERE m."idempotencyKey" = 'OPENING_BALANCE:' || sl."id"
     );

  IF orphan_count > 0 THEN
    SELECT string_agg(sample.id, ', ') INTO orphan_ids
      FROM (
        SELECT sl."id"
          FROM "stock_levels" sl
         WHERE sl."quantity" <> 0
           AND NOT EXISTS (
             SELECT 1 FROM "stock_movements" m WHERE m."idempotencyKey" = 'OPENING_BALANCE:' || sl."id"
           )
         ORDER BY sl."id" LIMIT 20
      ) AS sample;

    RAISE EXCEPTION
      'Refusing to introduce the inventory ledger: % stock level(s) hold a non-zero balance but could not be attributed to a single tenant (the store and the variant disagree, or a parent row is missing). No data has been changed. Inspect these stock level ids first: %',
      orphan_count, orphan_ids;
  END IF;
END $$;

-- Verify the projection invariant the application will rely on from here on:
--   for every (store, variant), stock_levels.quantity = SUM(stock_movements.quantityDelta)
-- Checking it here means the invariant is true before any application code depends on it,
-- rather than being asserted in a document and discovered false in production.
DO $$
DECLARE
  mismatch_count integer;
  mismatch_ids   text;
BEGIN
  SELECT count(*) INTO mismatch_count
    FROM "stock_levels" sl
   WHERE sl."quantity" <> COALESCE((
           SELECT SUM(m."quantityDelta")
             FROM "stock_movements" m
            WHERE m."storeId" = sl."storeId" AND m."variantId" = sl."variantId"
         ), 0);

  IF mismatch_count > 0 THEN
    SELECT string_agg(sample.id, ', ') INTO mismatch_ids
      FROM (
        SELECT sl."id"
          FROM "stock_levels" sl
         WHERE sl."quantity" <> COALESCE((
                 SELECT SUM(m."quantityDelta")
                   FROM "stock_movements" m
                  WHERE m."storeId" = sl."storeId" AND m."variantId" = sl."variantId"
               ), 0)
         ORDER BY sl."id" LIMIT 20
      ) AS sample;

    RAISE EXCEPTION
      'Opening-balance backfill did not reconcile: % stock level(s) disagree with the sum of their movements. Rolling back. Stock level ids: %',
      mismatch_count, mismatch_ids;
  END IF;
END $$;
