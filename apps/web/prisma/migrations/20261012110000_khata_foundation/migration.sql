-- Migration: 20261012110000_khata_foundation
-- Schema prerequisites for future Khata (on-account) enablement.
-- Explicit credit enablement, hold/suspension, phone verification timestamp, and immutable initial allocation on sales.

ALTER TABLE "customers"
    ADD COLUMN "creditEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "creditHold" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "phoneVerifiedAt" TIMESTAMP(3);

ALTER TABLE "sales"
    ADD COLUMN "initialOnAccountMinor" INTEGER NOT NULL DEFAULT 0;

-- Constraint ensuring initialOnAccountMinor is non-negative and does not exceed totalMinor
ALTER TABLE "sales"
    ADD CONSTRAINT "chk_sales_initial_on_account_bounds"
    CHECK ("initialOnAccountMinor" >= 0 AND "initialOnAccountMinor" <= "totalMinor");
