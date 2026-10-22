-- Udhar groundwork: an explicit credit mode per Company default and per customer credit account.
-- Nothing reads these columns yet; checkout and payment collection stay disabled.
--
-- Fail-closed by construction:
--   * every mode column is NOT NULL and defaults to BLOCKED, so "unset" cannot exist;
--   * UNLIMITED is its own value, never inferred from a NULL limit;
--   * LIMITED requires a positive limit, BLOCKED and UNLIMITED require no limit (CHECKs below).
--
-- The legacy "customer_credit_accounts"."creditLimitMinor" column is left untouched: deciding
-- what an old limit means under the new modes is deferred, so the mode's limit has its own column.

CREATE TYPE "CreditMode" AS ENUM ('BLOCKED', 'UNLIMITED', 'LIMITED');

-- How an account's mode was set. MIGRATED marks accounts that existed before modes did.
CREATE TYPE "CreditModeSource" AS ENUM ('COMPANY_DEFAULT', 'OWNER_OVERRIDE', 'MIGRATED');

ALTER TABLE "companies"
    ADD COLUMN "defaultCreditMode" "CreditMode" NOT NULL DEFAULT 'BLOCKED',
    ADD COLUMN "defaultCreditLimitMinor" INTEGER,
    ADD CONSTRAINT "chk_companies_default_credit_limit" CHECK (
        ("defaultCreditMode" = 'LIMITED' AND "defaultCreditLimitMinor" IS NOT NULL AND "defaultCreditLimitMinor" > 0)
        OR ("defaultCreditMode" <> 'LIMITED' AND "defaultCreditLimitMinor" IS NULL)
    );

ALTER TABLE "customer_credit_accounts"
    ADD COLUMN "creditMode" "CreditMode" NOT NULL DEFAULT 'BLOCKED',
    ADD COLUMN "creditModeLimitMinor" INTEGER,
    ADD COLUMN "creditModeSource" "CreditModeSource" NOT NULL DEFAULT 'MIGRATED',
    ADD COLUMN "creditModeSetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Existing accounts become BLOCKED explicitly, whatever their legacy flags or limit say.
UPDATE "customer_credit_accounts"
SET "creditMode" = 'BLOCKED',
    "creditModeLimitMinor" = NULL,
    "creditModeSource" = 'MIGRATED';

ALTER TABLE "customer_credit_accounts"
    ADD CONSTRAINT "chk_cca_credit_mode_limit" CHECK (
        ("creditMode" = 'LIMITED' AND "creditModeLimitMinor" IS NOT NULL AND "creditModeLimitMinor" > 0)
        OR ("creditMode" <> 'LIMITED' AND "creditModeLimitMinor" IS NULL)
    );
