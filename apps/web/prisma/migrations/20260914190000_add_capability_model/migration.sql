-- P1-8F — tenant capability model.
--
-- Additive and non-destructive: one new enum type, one new table, one backfill INSERT.
-- No existing table is altered, no column is dropped, no data is rewritten.
--
-- BACKFILL, stated explicitly because "what happens to tenants that already exist" is the
-- one question a capability migration must not leave to inference:
--
--   every existing tenant receives RETAIL, enabled.
--
-- Not derived from Tenant.businessType. Every tenant in this system can ring up a sale today
-- regardless of the businessType they picked at registration, so granting by businessType
-- would switch POS off for a tenant whose type says WHOLESALE but who sells over a counter.
-- That is precisely the accidental break this backfill exists to prevent.
--
-- No other capability is granted. WHOLESALE, MANUFACTURING, JOB_WORK, PROCUREMENT, COMMERCE
-- and DISTRIBUTION have no implementation behind them yet; granting them would assert a
-- module the tenant does not have and cannot use. Absent row = off.

CREATE TYPE "Capability" AS ENUM (
  'RETAIL',
  'WHOLESALE',
  'MANUFACTURING',
  'JOB_WORK',
  'PROCUREMENT',
  'COMMERCE',
  'DISTRIBUTION'
);

CREATE TABLE "tenant_capabilities" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "capability" "Capability" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_capabilities_pkey" PRIMARY KEY ("id")
);

-- The whole integrity story: two rows for one tenant and capability could disagree about
-- whether the module is on, and a check reading "one of them" would be non-deterministic.
CREATE UNIQUE INDEX "tenant_capabilities_tenantId_capability_key"
    ON "tenant_capabilities"("tenantId", "capability");

ALTER TABLE "tenant_capabilities"
    ADD CONSTRAINT "tenant_capabilities_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill. gen_random_uuid()::text rather than a cuid because this runs in SQL, and the id
-- is opaque everywhere it is read; nothing parses it. ON CONFLICT DO NOTHING makes the
-- statement safe to re-run against a database where the grant already exists.
INSERT INTO "tenant_capabilities" ("id", "tenantId", "capability", "enabled", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, t."id", 'RETAIL', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "tenants" t
ON CONFLICT ("tenantId", "capability") DO NOTHING;
