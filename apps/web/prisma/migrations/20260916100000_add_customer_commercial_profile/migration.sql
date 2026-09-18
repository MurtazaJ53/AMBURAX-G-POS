-- W-1 — customer commercial profile.
--
-- Additive and non-destructive: one enum type and three columns on an existing table. Nothing is
-- dropped, nothing is rewritten, and no backfill is needed — `customerType` carries a DEFAULT of
-- RETAIL, so every existing customer keeps exactly the meaning it already had.
--
-- An extension of `Customer`, deliberately not a second customer entity. A wholesale buyer and a
-- walk-in are the same kind of thing with different commercial terms; splitting them would give
-- the platform two customer systems to keep in step, which is the outcome the shared-core rule
-- exists to prevent.
--
-- All three columns are CONFIGURATION, not accounting state:
--
--   * `customerType`     — retail, wholesale or distributor.
--   * `paymentTermsDays` — an agreed credit period, "NET 30" being 30. Not a payment schedule;
--                          nothing computes a due date from it.
--   * `creditLimitMinor` — an agreed ceiling, in integer minor units. **Stored, never enforced.**
--                          No order is refused because of it and no "available credit" is
--                          computed anywhere, because that needs the outstanding balance, which
--                          ERPNext owns and this system cannot see. Enforcement is W-7 and
--                          depends on ERP integration existing first.
--
-- What this migration deliberately does NOT touch: `@@unique([tenantId, phone])`. Phone is the
-- creation-dedup key for retail — `createCustomer` resolves on it so pressing "add" twice cannot
-- produce two records — and weakening it to suit B2B would change Retail behaviour that is
-- frozen and green. The B2B limitation is documented rather than silently fixed.

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('RETAIL', 'WHOLESALE', 'DISTRIBUTOR');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "creditLimitMinor" INTEGER,
ADD COLUMN     "customerType" "CustomerType" NOT NULL DEFAULT 'RETAIL',
ADD COLUMN     "paymentTermsDays" INTEGER;

