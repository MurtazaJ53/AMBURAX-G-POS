-- Enforce the tenant invariant on store_memberships in PostgreSQL itself.
--
-- Before this migration the table carried two independent foreign keys — userId -> users
-- and storeId -> stores. Each was individually satisfiable, so the database happily
-- accepted a tenant-A user as a member of a tenant-B store. Nothing in the application did
-- that, because every call site resolves the store through the session's tenant first, but
-- the protection lived in a convention repeated across call sites rather than in a rule.
--
-- The fix is a denormalised tenantId plus two composite foreign keys, so a membership row
-- can only exist when its user and its store agree on the same tenant.
--
-- The column is added NULLable and backfilled first. Prisma's generated version of this
-- migration would have been `ADD COLUMN "tenantId" TEXT NOT NULL`, which fails outright on
-- any database that already holds memberships — including every developer machine and the
-- integration test database.

-- 1. Add the column without a constraint, so existing rows survive this statement.
ALTER TABLE "store_memberships" ADD COLUMN "tenantId" TEXT;

-- 2. Backfill only where the user and the store ALREADY agree on a tenant. A row whose
--    user and store disagree is left NULL on purpose: there is no correct answer for it,
--    and picking either side would invent data and silently destroy the evidence of a real
--    cross-tenant leak.
UPDATE "store_memberships" AS m
   SET "tenantId" = u."tenantId"
  FROM "users" AS u, "stores" AS s
 WHERE m."userId" = u."id"
   AND m."storeId" = s."id"
   AND u."tenantId" = s."tenantId";

-- 3. Stop the migration if anything could not be attributed. Failing here aborts the whole
--    transaction and leaves the database exactly as it was, with the offending rows intact
--    for inspection — the alternative (assigning an arbitrary tenant) would launder a
--    cross-tenant membership into a legitimate-looking one.
DO $$
DECLARE
  offending_count integer;
  offending_ids   text;
BEGIN
  SELECT count(*) INTO offending_count
    FROM "store_memberships"
   WHERE "tenantId" IS NULL;

  IF offending_count > 0 THEN
    SELECT string_agg(sample.id, ', ') INTO offending_ids
      FROM (
        SELECT "id" FROM "store_memberships" WHERE "tenantId" IS NULL ORDER BY "id" LIMIT 20
      ) AS sample;

    RAISE EXCEPTION
      'Refusing to enforce the store_memberships tenant invariant: % row(s) cannot be attributed to a single tenant (user and store disagree, or a parent row is missing). No data has been changed. Inspect these membership ids and resolve them by hand first: %',
      offending_count, offending_ids;
  END IF;
END $$;

-- 4. Every surviving row now has a tenant, so the constraint can be applied.
ALTER TABLE "store_memberships" ALTER COLUMN "tenantId" SET NOT NULL;

-- 5. The referencable halves of the composite keys. Both are redundant as uniqueness rules
--    (id is already the primary key on each table); they exist so PostgreSQL will accept
--    (id, tenantId) as a foreign-key target.
CREATE UNIQUE INDEX "users_id_tenantId_key" ON "users"("id", "tenantId");
CREATE UNIQUE INDEX "stores_id_tenantId_key" ON "stores"("id", "tenantId");

-- 6. Replace the two single-column foreign keys with tenant-aware composites. Dropping
--    first is required: the old constraints are a strict subset of the new ones, and
--    keeping both would only duplicate the same check.
ALTER TABLE "store_memberships" DROP CONSTRAINT "store_memberships_userId_fkey";
ALTER TABLE "store_memberships" DROP CONSTRAINT "store_memberships_storeId_fkey";

ALTER TABLE "store_memberships"
  ADD CONSTRAINT "store_memberships_userId_tenantId_fkey"
  FOREIGN KEY ("userId", "tenantId") REFERENCES "users"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "store_memberships"
  ADD CONSTRAINT "store_memberships_storeId_tenantId_fkey"
  FOREIGN KEY ("storeId", "tenantId") REFERENCES "stores"("id", "tenantId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 7. Tenant-scoped reads of this table are now a supported access path.
CREATE INDEX "store_memberships_tenantId_idx" ON "store_memberships"("tenantId");
