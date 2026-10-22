-- Migration: 20261012120000_khata_multicompany_ledger_foundation
-- Multi-company legal scope, CustomerCreditAccount, and dual Khata ledgers (Receivable & Advance).
-- Database-enforced reversal integrity, source linkage preservation, single-reversal partial indexes,
-- and ledger UPDATE/DELETE immutability.
-- Staged migration: preserves existing stores and sales without guessing legal entities or currency.

-- 1. ENUMS
CREATE TYPE "KhataReceivableEntryType" AS ENUM (
    'DEBIT_CREDIT_SALE',
    'CREDIT_REPAYMENT',
    'CREDIT_SALE_RETURN',
    'CREDIT_ADVANCE_APPLY',
    'DEBIT_REVERSAL',
    'CREDIT_REVERSAL'
);

CREATE TYPE "KhataAdvanceEntryType" AS ENUM (
    'CREDIT_ADVANCE_DEPOSIT',
    'DEBIT_APPLICATION',
    'DEBIT_REFUND',
    'DEBIT_REVERSAL',
    'CREDIT_REVERSAL'
);

-- 2. COMPANIES TABLE
CREATE TABLE "companies" (
    "id"                      TEXT NOT NULL,
    "tenantId"                TEXT NOT NULL,
    "name"                    TEXT NOT NULL,
    "code"                    TEXT NOT NULL,
    "currency"                TEXT NOT NULL,
    "defaultPaymentTermsDays" INTEGER NOT NULL DEFAULT 0,
    "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fk_companies_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "companies_tenantId_code_key" UNIQUE ("tenantId", "code"),
    CONSTRAINT "companies_id_tenantId_key" UNIQUE ("id", "tenantId"),
    CONSTRAINT "companies_id_tenantId_currency_key" UNIQUE ("id", "tenantId", "currency")
);

-- 3. STORE COMPANY LINKAGE (STAGED / NULLABLE - NO GUESSED MAPPING)
-- Stores preserve their existing authoritative Store.currency.
-- companyId remains NULL until an explicit, authorized legal entity mapping is assigned.
ALTER TABLE "stores"
    ADD COLUMN "companyId" TEXT;

ALTER TABLE "stores"
    ADD CONSTRAINT "fk_stores_company" FOREIGN KEY ("companyId", "tenantId") REFERENCES "companies"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. SALE COMPANY LINKAGE & DUE DATE SNAPSHOTS (STAGED / NULLABLE - NO FABRICATED DEFAULTS)
ALTER TABLE "sales"
    ADD COLUMN "companyId" TEXT,
    ADD COLUMN "currencySnapshot" TEXT,
    ADD COLUMN "effectiveTermsDaysSnapshot" INTEGER,
    ADD COLUMN "dueDateSnapshot" TIMESTAMP(3);

ALTER TABLE "sales"
    ADD CONSTRAINT "fk_sales_company" FOREIGN KEY ("companyId", "tenantId") REFERENCES "companies"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5. CUSTOMER CREDIT ACCOUNTS (SCOPED BY TENANT, COMPANY, CUSTOMER, CURRENCY)
CREATE TABLE "customer_credit_accounts" (
    "id"               TEXT NOT NULL,
    "tenantId"         TEXT NOT NULL,
    "companyId"        TEXT NOT NULL,
    "customerId"       TEXT NOT NULL,
    "currency"         TEXT NOT NULL,
    "creditLimitMinor" INTEGER,
    "creditEnabled"    BOOLEAN NOT NULL DEFAULT false,
    "creditHold"       BOOLEAN NOT NULL DEFAULT false,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_credit_accounts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fk_cca_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_cca_company" FOREIGN KEY ("companyId", "tenantId") REFERENCES "companies"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_cca_customer" FOREIGN KEY ("customerId", "tenantId") REFERENCES "customers"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "customer_credit_accounts_tenantId_companyId_customerId_key" UNIQUE ("tenantId", "companyId", "customerId"),
    CONSTRAINT "customer_credit_accounts_id_tenantId_companyId_customerId_currency_key" UNIQUE ("id", "tenantId", "companyId", "customerId", "currency")
);

-- 6. KHATA PAYMENTS (COLLECTION RECORDS)
CREATE TABLE IF NOT EXISTS "khata_payments" (
    "id"                TEXT NOT NULL,
    "tenantId"          TEXT NOT NULL,
    "companyId"         TEXT,
    "customerId"        TEXT NOT NULL,
    "creditAccountId"   TEXT,
    "currency"          TEXT,
    "actorUserId"       TEXT NOT NULL,
    "amountMinor"       INTEGER NOT NULL,
    "paymentMethod"     "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "reference"         TEXT,
    "notes"             TEXT,
    "idempotencyKey"    TEXT NOT NULL,
    "erpSyncStatus"     "ErpSyncStatus" NOT NULL DEFAULT 'PENDING',
    "erpPaymentEntryId" TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "khata_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fk_kp_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_kp_customer" FOREIGN KEY ("customerId", "tenantId") REFERENCES "customers"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_kp_company" FOREIGN KEY ("companyId", "tenantId") REFERENCES "companies"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_kp_credit_account" FOREIGN KEY ("creditAccountId", "tenantId", "companyId", "customerId", "currency")
        REFERENCES "customer_credit_accounts"("id", "tenantId", "companyId", "customerId", "currency") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "khata_payments_idempotencyKey_key" UNIQUE ("idempotencyKey"),
    CONSTRAINT "uq_kp_full_scope" UNIQUE ("id", "tenantId", "companyId", "customerId", "creditAccountId", "currency")
);

CREATE INDEX "khata_payments_tenantId_customerId_idx" ON "khata_payments"("tenantId", "customerId");
CREATE INDEX "khata_payments_tenantId_createdAt_idx" ON "khata_payments"("tenantId", "createdAt");

-- 8. ALLOCATION TABLES (STRICTLY SCOPED BY TENANT, COMPANY, CUSTOMER, ACCOUNT, CURRENCY)
CREATE TABLE "khata_payment_allocations" (
    "id"              TEXT NOT NULL,
    "tenantId"        TEXT NOT NULL,
    "companyId"       TEXT NOT NULL,
    "customerId"      TEXT NOT NULL,
    "creditAccountId" TEXT NOT NULL,
    "currency"        TEXT NOT NULL,
    "khataPaymentId"  TEXT NOT NULL,
    "saleId"          TEXT NOT NULL,
    "amountMinor"     INTEGER NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "khata_payment_allocations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fk_kpa_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_kpa_company" FOREIGN KEY ("companyId", "tenantId") REFERENCES "companies"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_kpa_customer" FOREIGN KEY ("customerId", "tenantId") REFERENCES "customers"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_kpa_credit_account" FOREIGN KEY ("creditAccountId", "tenantId", "companyId", "customerId", "currency")
        REFERENCES "customer_credit_accounts"("id", "tenantId", "companyId", "customerId", "currency") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_kpa_payment" FOREIGN KEY ("khataPaymentId") REFERENCES "khata_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_kpa_payment_full_scope" FOREIGN KEY ("khataPaymentId", "tenantId", "companyId", "customerId", "creditAccountId", "currency")
        REFERENCES "khata_payments"("id", "tenantId", "companyId", "customerId", "creditAccountId", "currency") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_kpa_sale" FOREIGN KEY ("saleId", "tenantId") REFERENCES "sales"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "uq_kpa_full_scope" UNIQUE ("id", "tenantId", "companyId", "customerId", "creditAccountId", "currency"),
    CONSTRAINT "chk_kpa_amount_positive" CHECK ("amountMinor" > 0 AND "amountMinor" <= 2147483647)
);

CREATE INDEX "khata_payment_allocations_tenantId_khataPaymentId_idx" ON "khata_payment_allocations"("tenantId", "khataPaymentId");
CREATE INDEX "khata_payment_allocations_tenantId_saleId_idx" ON "khata_payment_allocations"("tenantId", "saleId");

CREATE TABLE "khata_advance_allocations" (
    "id"              TEXT NOT NULL,
    "tenantId"        TEXT NOT NULL,
    "companyId"       TEXT NOT NULL,
    "customerId"      TEXT NOT NULL,
    "creditAccountId" TEXT NOT NULL,
    "currency"        TEXT NOT NULL,
    "saleId"          TEXT NOT NULL,
    "amountMinor"     INTEGER NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "khata_advance_allocations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fk_kaa_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_kaa_company" FOREIGN KEY ("companyId", "tenantId") REFERENCES "companies"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_kaa_customer" FOREIGN KEY ("customerId", "tenantId") REFERENCES "customers"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_kaa_credit_account" FOREIGN KEY ("creditAccountId", "tenantId", "companyId", "customerId", "currency")
        REFERENCES "customer_credit_accounts"("id", "tenantId", "companyId", "customerId", "currency") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_kaa_sale" FOREIGN KEY ("saleId", "tenantId") REFERENCES "sales"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "uq_kaa_full_scope" UNIQUE ("id", "tenantId", "companyId", "customerId", "creditAccountId", "currency"),
    CONSTRAINT "chk_kaa_amount_positive" CHECK ("amountMinor" > 0 AND "amountMinor" <= 2147483647)
);

CREATE INDEX "khata_advance_allocations_tenantId_saleId_idx" ON "khata_advance_allocations"("tenantId", "saleId");

-- 7. KHATA RECEIVABLE ENTRIES TABLE
CREATE TABLE "khata_receivable_entries" (
    "id"                   TEXT NOT NULL,
    "tenantId"             TEXT NOT NULL,
    "companyId"            TEXT NOT NULL,
    "customerId"           TEXT NOT NULL,
    "creditAccountId"      TEXT NOT NULL,
    "currency"             TEXT NOT NULL,

    "entryType"            "KhataReceivableEntryType" NOT NULL,
    "amountMinor"          INTEGER NOT NULL,

    -- Source Lineage Links
    "saleId"               TEXT,
    "paymentAllocationId"  TEXT,
    "allocationId"         TEXT,
    "saleReturnId"         TEXT,

    -- Reversal Pointers (Full 6-tuple parent pointer)
    "reversalOfId"         TEXT,
    "reversalOfTenantId"   TEXT,
    "reversalOfCompanyId"  TEXT,
    "reversalOfCustomerId" TEXT,
    "reversalOfAccountId"  TEXT,
    "reversalOfCurrency"   TEXT,

    "actorUserId"          TEXT NOT NULL,
    "notes"                TEXT,
    "idempotencyKey"       TEXT NOT NULL,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "khata_receivable_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fk_rec_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_rec_company" FOREIGN KEY ("companyId", "tenantId") REFERENCES "companies"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_rec_customer" FOREIGN KEY ("customerId", "tenantId") REFERENCES "customers"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_rec_credit_account" FOREIGN KEY ("creditAccountId", "tenantId", "companyId", "customerId", "currency")
        REFERENCES "customer_credit_accounts"("id", "tenantId", "companyId", "customerId", "currency") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_rec_sale" FOREIGN KEY ("saleId", "tenantId") REFERENCES "sales"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_rec_payment_allocation" FOREIGN KEY ("paymentAllocationId") REFERENCES "khata_payment_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_rec_advance_allocation" FOREIGN KEY ("allocationId") REFERENCES "khata_advance_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_rec_sale_return" FOREIGN KEY ("saleReturnId") REFERENCES "sale_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_rec_reversal_parent" FOREIGN KEY ("reversalOfId", "reversalOfTenantId", "reversalOfCompanyId", "reversalOfCustomerId", "reversalOfAccountId", "reversalOfCurrency")
        REFERENCES "khata_receivable_entries"("id", "tenantId", "companyId", "customerId", "creditAccountId", "currency") ON DELETE RESTRICT ON UPDATE CASCADE,

    CONSTRAINT "khata_receivable_entries_tenantId_idempotencyKey_key" UNIQUE ("tenantId", "idempotencyKey"),
    CONSTRAINT "uq_rec_full_scope_entry" UNIQUE ("id", "tenantId", "companyId", "customerId", "creditAccountId", "currency"),
    CONSTRAINT "chk_rec_amount_positive" CHECK ("amountMinor" > 0 AND "amountMinor" <= 2147483647),
    CONSTRAINT "chk_rec_entry_source_exclusivity" CHECK (
        ("entryType" = 'DEBIT_CREDIT_SALE' AND "saleId" IS NOT NULL AND "paymentAllocationId" IS NULL AND "allocationId" IS NULL AND "saleReturnId" IS NULL AND "reversalOfId" IS NULL) OR
        ("entryType" = 'CREDIT_REPAYMENT' AND "paymentAllocationId" IS NOT NULL AND "saleId" IS NOT NULL AND "allocationId" IS NULL AND "saleReturnId" IS NULL AND "reversalOfId" IS NULL) OR
        ("entryType" = 'CREDIT_ADVANCE_APPLY' AND "allocationId" IS NOT NULL AND "saleId" IS NOT NULL AND "paymentAllocationId" IS NULL AND "saleReturnId" IS NULL AND "reversalOfId" IS NULL) OR
        ("entryType" = 'CREDIT_SALE_RETURN' AND "saleReturnId" IS NOT NULL AND "saleId" IS NOT NULL AND "allocationId" IS NULL AND "paymentAllocationId" IS NULL AND "reversalOfId" IS NULL) OR
        ("entryType" IN ('DEBIT_REVERSAL', 'CREDIT_REVERSAL') AND "reversalOfId" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "uq_rec_single_reversal_partial"
ON "khata_receivable_entries" ("tenantId", "companyId", "customerId", "creditAccountId", "reversalOfId")
WHERE "reversalOfId" IS NOT NULL;

CREATE INDEX "khata_receivable_entries_tenantId_companyId_customerId_createdAt_idx"
ON "khata_receivable_entries"("tenantId", "companyId", "customerId", "createdAt");

CREATE INDEX "khata_receivable_entries_saleId_idx"
ON "khata_receivable_entries"("saleId");

-- 8. KHATA ADVANCE ENTRIES TABLE
CREATE TABLE "khata_advance_entries" (
    "id"                   TEXT NOT NULL,
    "tenantId"             TEXT NOT NULL,
    "companyId"            TEXT NOT NULL,
    "customerId"           TEXT NOT NULL,
    "creditAccountId"      TEXT NOT NULL,
    "currency"             TEXT NOT NULL,

    "entryType"            "KhataAdvanceEntryType" NOT NULL,
    "amountMinor"          INTEGER NOT NULL,

    -- Source Lineage Links
    "khataPaymentId"       TEXT,
    "allocationId"         TEXT,

    -- Reversal Pointers (Full 6-tuple parent pointer)
    "reversalOfId"         TEXT,
    "reversalOfTenantId"   TEXT,
    "reversalOfCompanyId"  TEXT,
    "reversalOfCustomerId" TEXT,
    "reversalOfAccountId"  TEXT,
    "reversalOfCurrency"   TEXT,

    "actorUserId"          TEXT NOT NULL,
    "notes"                TEXT,
    "idempotencyKey"       TEXT NOT NULL,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "khata_advance_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fk_adv_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_adv_company" FOREIGN KEY ("companyId", "tenantId") REFERENCES "companies"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_adv_customer" FOREIGN KEY ("customerId", "tenantId") REFERENCES "customers"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_adv_credit_account" FOREIGN KEY ("creditAccountId", "tenantId", "companyId", "customerId", "currency")
        REFERENCES "customer_credit_accounts"("id", "tenantId", "companyId", "customerId", "currency") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_adv_khata_payment" FOREIGN KEY ("khataPaymentId") REFERENCES "khata_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_adv_advance_allocation" FOREIGN KEY ("allocationId") REFERENCES "khata_advance_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fk_adv_reversal_parent" FOREIGN KEY ("reversalOfId", "reversalOfTenantId", "reversalOfCompanyId", "reversalOfCustomerId", "reversalOfAccountId", "reversalOfCurrency")
        REFERENCES "khata_advance_entries"("id", "tenantId", "companyId", "customerId", "creditAccountId", "currency") ON DELETE RESTRICT ON UPDATE CASCADE,

    CONSTRAINT "khata_advance_entries_tenantId_idempotencyKey_key" UNIQUE ("tenantId", "idempotencyKey"),
    CONSTRAINT "uq_adv_full_scope_entry" UNIQUE ("id", "tenantId", "companyId", "customerId", "creditAccountId", "currency"),
    CONSTRAINT "chk_adv_amount_positive" CHECK ("amountMinor" > 0 AND "amountMinor" <= 2147483647),
    CONSTRAINT "chk_adv_entry_source_exclusivity" CHECK (
        ("entryType" = 'CREDIT_ADVANCE_DEPOSIT' AND "khataPaymentId" IS NOT NULL AND "allocationId" IS NULL AND "reversalOfId" IS NULL) OR
        ("entryType" = 'DEBIT_APPLICATION' AND "allocationId" IS NOT NULL AND "khataPaymentId" IS NULL AND "reversalOfId" IS NULL) OR
        ("entryType" = 'DEBIT_REFUND' AND "khataPaymentId" IS NULL AND "allocationId" IS NULL AND "reversalOfId" IS NULL) OR
        ("entryType" IN ('DEBIT_REVERSAL', 'CREDIT_REVERSAL') AND "reversalOfId" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "uq_adv_single_reversal_partial"
ON "khata_advance_entries" ("tenantId", "companyId", "customerId", "creditAccountId", "reversalOfId")
WHERE "reversalOfId" IS NOT NULL;

CREATE INDEX "khata_advance_entries_tenantId_companyId_customerId_createdAt_idx"
ON "khata_advance_entries"("tenantId", "companyId", "customerId", "createdAt");

CREATE INDEX "khata_advance_entries_khataPaymentId_idx"
ON "khata_advance_entries"("khataPaymentId");

-- 9. IMMUTABILITY TRIGGERS (LEDGER ENTRIES & ALLOCATIONS ARE APPEND-ONLY)
CREATE OR REPLACE FUNCTION fn_prevent_ledger_update_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Khata ledger rows and allocations are append-only and strictly immutable. UPDATE and DELETE are prohibited on table %', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_immutable_rec_entries ON "khata_receivable_entries";
CREATE TRIGGER trg_immutable_rec_entries
BEFORE UPDATE OR DELETE ON "khata_receivable_entries"
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_ledger_update_delete();

DROP TRIGGER IF EXISTS trg_immutable_adv_entries ON "khata_advance_entries";
CREATE TRIGGER trg_immutable_adv_entries
BEFORE UPDATE OR DELETE ON "khata_advance_entries"
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_ledger_update_delete();

DROP TRIGGER IF EXISTS trg_immutable_pay_allocations ON "khata_payment_allocations";
CREATE TRIGGER trg_immutable_pay_allocations
BEFORE UPDATE OR DELETE ON "khata_payment_allocations"
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_ledger_update_delete();

DROP TRIGGER IF EXISTS trg_immutable_adv_allocations ON "khata_advance_allocations";
CREATE TRIGGER trg_immutable_adv_allocations
BEFORE UPDATE OR DELETE ON "khata_advance_allocations"
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_ledger_update_delete();

-- 10. REVERSAL INTEGRITY TRIGGERS
CREATE OR REPLACE FUNCTION fn_validate_receivable_reversal_integrity()
RETURNS TRIGGER AS $$
DECLARE
    v_orig RECORD;
BEGIN
    IF NEW."reversalOfId" IS NULL THEN
        IF NEW."reversalOfTenantId" IS NOT NULL OR
           NEW."reversalOfCompanyId" IS NOT NULL OR
           NEW."reversalOfCustomerId" IS NOT NULL OR
           NEW."reversalOfAccountId" IS NOT NULL OR
           NEW."reversalOfCurrency" IS NOT NULL THEN
            RAISE EXCEPTION 'Non-reversal entry cannot carry reversal pointer metadata: tenant=%, company=%, customer=%, account=%, currency=%',
                NEW."reversalOfTenantId", NEW."reversalOfCompanyId", NEW."reversalOfCustomerId", NEW."reversalOfAccountId", NEW."reversalOfCurrency";
        END IF;
        RETURN NEW;
    END IF;

    -- 1. Complete Scope Parity: Reversal pointer metadata MUST match the NEW row's own scope fields
    IF NEW."reversalOfTenantId" IS DISTINCT FROM NEW."tenantId" THEN
        RAISE EXCEPTION 'Reversal pointer tenant (%) disagrees with NEW row tenant (%)',
            NEW."reversalOfTenantId", NEW."tenantId";
    END IF;

    IF NEW."reversalOfCompanyId" IS DISTINCT FROM NEW."companyId" THEN
        RAISE EXCEPTION 'Reversal pointer company (%) disagrees with NEW row company (%)',
            NEW."reversalOfCompanyId", NEW."companyId";
    END IF;

    IF NEW."reversalOfCustomerId" IS DISTINCT FROM NEW."customerId" THEN
        RAISE EXCEPTION 'Reversal pointer customer (%) disagrees with NEW row customer (%)',
            NEW."reversalOfCustomerId", NEW."customerId";
    END IF;

    IF NEW."reversalOfAccountId" IS DISTINCT FROM NEW."creditAccountId" THEN
        RAISE EXCEPTION 'Reversal pointer account (%) disagrees with NEW row account (%)',
            NEW."reversalOfAccountId", NEW."creditAccountId";
    END IF;

    IF NEW."reversalOfCurrency" IS DISTINCT FROM NEW."currency" THEN
        RAISE EXCEPTION 'Reversal pointer currency (%) disagrees with NEW row currency (%)',
            NEW."reversalOfCurrency", NEW."currency";
    END IF;

    -- 2. Reject self-reversal
    IF NEW."id" = NEW."reversalOfId" THEN
        RAISE EXCEPTION 'Entry % cannot reverse itself', NEW."id";
    END IF;

    -- 3. Original row lookup & row-level exclusive lock
    SELECT * INTO v_orig
    FROM "khata_receivable_entries"
    WHERE "id" = NEW."reversalOfId"
      AND "tenantId" = NEW."reversalOfTenantId"
      AND "companyId" = NEW."reversalOfCompanyId"
      AND "customerId" = NEW."reversalOfCustomerId"
      AND "creditAccountId" = NEW."reversalOfAccountId"
      AND "currency" = NEW."reversalOfCurrency"
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Original receivable entry % not found under complete scope (tenant=%, company=%, customer=%, account=%, currency=%)',
            NEW."reversalOfId", NEW."reversalOfTenantId", NEW."reversalOfCompanyId", NEW."reversalOfCustomerId", NEW."reversalOfAccountId", NEW."reversalOfCurrency";
    END IF;

    -- 4. Reject reversal of an existing reversal entry
    IF v_orig."entryType" IN ('DEBIT_REVERSAL'::"KhataReceivableEntryType", 
                             'CREDIT_REVERSAL'::"KhataReceivableEntryType") THEN
        RAISE EXCEPTION 'Cannot reverse an existing reversal entry %', v_orig."id";
    END IF;

    -- 5. Reject second reversal if one already committed
    IF EXISTS (
        SELECT 1 FROM "khata_receivable_entries"
        WHERE "reversalOfId" = v_orig."id"
          AND "tenantId" = v_orig."tenantId"
          AND "companyId" = v_orig."companyId"
          AND "customerId" = v_orig."customerId"
          AND "creditAccountId" = v_orig."creditAccountId"
    ) THEN
        RAISE EXCEPTION 'Original receivable entry % has already been reversed', v_orig."id";
    END IF;

    -- 6. Strict Permitted Reversal Type Pairs:
    --    DEBIT_CREDIT_SALE     -> CREDIT_REVERSAL
    --    CREDIT_REPAYMENT      -> DEBIT_REVERSAL
    --    CREDIT_SALE_RETURN    -> DEBIT_REVERSAL
    --    CREDIT_ADVANCE_APPLY  -> DEBIT_REVERSAL
    IF v_orig."entryType" = 'DEBIT_CREDIT_SALE'::"KhataReceivableEntryType" THEN
        IF NEW."entryType" <> 'CREDIT_REVERSAL'::"KhataReceivableEntryType" THEN
            RAISE EXCEPTION 'DEBIT_CREDIT_SALE must be reversed by CREDIT_REVERSAL (got %)', NEW."entryType";
        END IF;
    ELSIF v_orig."entryType" IN ('CREDIT_REPAYMENT'::"KhataReceivableEntryType", 
                                'CREDIT_SALE_RETURN'::"KhataReceivableEntryType", 
                                'CREDIT_ADVANCE_APPLY'::"KhataReceivableEntryType") THEN
        IF NEW."entryType" <> 'DEBIT_REVERSAL'::"KhataReceivableEntryType" THEN
            RAISE EXCEPTION '% must be reversed by DEBIT_REVERSAL (got %)', v_orig."entryType", NEW."entryType";
        END IF;
    ELSE
        RAISE EXCEPTION 'Original entryType % cannot be reversed', v_orig."entryType";
    END IF;

    -- 7. Exact Scope Parity verification against original row
    IF NEW."tenantId"        IS DISTINCT FROM v_orig."tenantId" OR
       NEW."companyId"       IS DISTINCT FROM v_orig."companyId" OR
       NEW."customerId"      IS DISTINCT FROM v_orig."customerId" OR
       NEW."creditAccountId" IS DISTINCT FROM v_orig."creditAccountId" OR
       NEW."currency"        IS DISTINCT FROM v_orig."currency" THEN
        RAISE EXCEPTION 'Scope mismatch between reversal % and original %', NEW."id", v_orig."id";
    END IF;

    -- 8. Amount parity: reversal must exactly match original amount
    IF NEW."amountMinor" IS DISTINCT FROM v_orig."amountMinor" THEN
        RAISE EXCEPTION 'Reversal amount % does not match original amount %', NEW."amountMinor", v_orig."amountMinor";
    END IF;

    -- 9. Source linkage preservation: Reversal must mirror the exact source linkage of the parent
    IF NEW."saleId"              IS DISTINCT FROM v_orig."saleId" OR
       NEW."paymentAllocationId" IS DISTINCT FROM v_orig."paymentAllocationId" OR
       NEW."allocationId"        IS DISTINCT FROM v_orig."allocationId" OR
       NEW."saleReturnId"        IS DISTINCT FROM v_orig."saleReturnId" THEN
        RAISE EXCEPTION 'Source lineage mismatch between reversal % and original %', NEW."id", v_orig."id";
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_receivable_reversal_integrity ON "khata_receivable_entries";
CREATE TRIGGER trg_validate_receivable_reversal_integrity
BEFORE INSERT ON "khata_receivable_entries"
FOR EACH ROW
EXECUTE FUNCTION fn_validate_receivable_reversal_integrity();

CREATE OR REPLACE FUNCTION fn_validate_advance_reversal_integrity()
RETURNS TRIGGER AS $$
DECLARE
    v_orig RECORD;
BEGIN
    IF NEW."reversalOfId" IS NULL THEN
        IF NEW."reversalOfTenantId" IS NOT NULL OR
           NEW."reversalOfCompanyId" IS NOT NULL OR
           NEW."reversalOfCustomerId" IS NOT NULL OR
           NEW."reversalOfAccountId" IS NOT NULL OR
           NEW."reversalOfCurrency" IS NOT NULL THEN
            RAISE EXCEPTION 'Non-reversal entry cannot carry reversal pointer metadata: tenant=%, company=%, customer=%, account=%, currency=%',
                NEW."reversalOfTenantId", NEW."reversalOfCompanyId", NEW."reversalOfCustomerId", NEW."reversalOfAccountId", NEW."reversalOfCurrency";
        END IF;
        RETURN NEW;
    END IF;

    -- 1. Complete Scope Parity: Reversal pointer metadata MUST match the NEW row's own scope fields
    IF NEW."reversalOfTenantId" IS DISTINCT FROM NEW."tenantId" THEN
        RAISE EXCEPTION 'Reversal pointer tenant (%) disagrees with NEW row tenant (%)',
            NEW."reversalOfTenantId", NEW."tenantId";
    END IF;

    IF NEW."reversalOfCompanyId" IS DISTINCT FROM NEW."companyId" THEN
        RAISE EXCEPTION 'Reversal pointer company (%) disagrees with NEW row company (%)',
            NEW."reversalOfCompanyId", NEW."companyId";
    END IF;

    IF NEW."reversalOfCustomerId" IS DISTINCT FROM NEW."customerId" THEN
        RAISE EXCEPTION 'Reversal pointer customer (%) disagrees with NEW row customer (%)',
            NEW."reversalOfCustomerId", NEW."customerId";
    END IF;

    IF NEW."reversalOfAccountId" IS DISTINCT FROM NEW."creditAccountId" THEN
        RAISE EXCEPTION 'Reversal pointer account (%) disagrees with NEW row account (%)',
            NEW."reversalOfAccountId", NEW."creditAccountId";
    END IF;

    IF NEW."reversalOfCurrency" IS DISTINCT FROM NEW."currency" THEN
        RAISE EXCEPTION 'Reversal pointer currency (%) disagrees with NEW row currency (%)',
            NEW."reversalOfCurrency", NEW."currency";
    END IF;

    -- 2. Reject self-reversal
    IF NEW."id" = NEW."reversalOfId" THEN
        RAISE EXCEPTION 'Advance entry % cannot reverse itself', NEW."id";
    END IF;

    -- 3. Original row lookup & row-level exclusive lock
    SELECT * INTO v_orig
    FROM "khata_advance_entries"
    WHERE "id" = NEW."reversalOfId"
      AND "tenantId" = NEW."reversalOfTenantId"
      AND "companyId" = NEW."reversalOfCompanyId"
      AND "customerId" = NEW."reversalOfCustomerId"
      AND "creditAccountId" = NEW."reversalOfAccountId"
      AND "currency" = NEW."reversalOfCurrency"
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Original advance entry % not found under complete scope (tenant=%, company=%, customer=%, account=%, currency=%)',
            NEW."reversalOfId", NEW."reversalOfTenantId", NEW."reversalOfCompanyId", NEW."reversalOfCustomerId", NEW."reversalOfAccountId", NEW."reversalOfCurrency";
    END IF;

    -- 4. Reject reversal of an existing reversal entry
    IF v_orig."entryType" IN ('DEBIT_REVERSAL'::"KhataAdvanceEntryType", 
                             'CREDIT_REVERSAL'::"KhataAdvanceEntryType") THEN
        RAISE EXCEPTION 'Cannot reverse an existing reversal entry %', v_orig."id";
    END IF;

    -- 5. Reject second reversal if one already committed
    IF EXISTS (
        SELECT 1 FROM "khata_advance_entries"
        WHERE "reversalOfId" = v_orig."id"
          AND "tenantId" = v_orig."tenantId"
          AND "companyId" = v_orig."companyId"
          AND "customerId" = v_orig."customerId"
          AND "creditAccountId" = v_orig."creditAccountId"
    ) THEN
        RAISE EXCEPTION 'Original advance entry % has already been reversed', v_orig."id";
    END IF;

    -- 6. Strict Permitted Reversal Type Pairs:
    --    CREDIT_ADVANCE_DEPOSIT <-> DEBIT_REVERSAL
    --    DEBIT_APPLICATION      <-> CREDIT_REVERSAL
    --    DEBIT_REFUND           <-> CREDIT_REVERSAL
    IF v_orig."entryType" = 'CREDIT_ADVANCE_DEPOSIT'::"KhataAdvanceEntryType" THEN
        IF NEW."entryType" <> 'DEBIT_REVERSAL'::"KhataAdvanceEntryType" THEN
            RAISE EXCEPTION 'CREDIT_ADVANCE_DEPOSIT must be reversed by DEBIT_REVERSAL (got %)', NEW."entryType";
        END IF;
    ELSIF v_orig."entryType" IN ('DEBIT_APPLICATION'::"KhataAdvanceEntryType", 
                                'DEBIT_REFUND'::"KhataAdvanceEntryType") THEN
        IF NEW."entryType" <> 'CREDIT_REVERSAL'::"KhataAdvanceEntryType" THEN
            RAISE EXCEPTION '% must be reversed by CREDIT_REVERSAL (got %)', v_orig."entryType", NEW."entryType";
        END IF;
    ELSE
        RAISE EXCEPTION 'Original advance entryType % cannot be reversed', v_orig."entryType";
    END IF;

    -- 7. Exact Scope Parity verification against original row
    IF NEW."tenantId"        IS DISTINCT FROM v_orig."tenantId" OR
       NEW."companyId"       IS DISTINCT FROM v_orig."companyId" OR
       NEW."customerId"      IS DISTINCT FROM v_orig."customerId" OR
       NEW."creditAccountId" IS DISTINCT FROM v_orig."creditAccountId" OR
       NEW."currency"        IS DISTINCT FROM v_orig."currency" THEN
        RAISE EXCEPTION 'Scope mismatch between advance reversal % and original %', NEW."id", v_orig."id";
    END IF;

    -- 8. Amount parity: reversal must exactly match original amount
    IF NEW."amountMinor" IS DISTINCT FROM v_orig."amountMinor" THEN
        RAISE EXCEPTION 'Advance reversal amount % does not match original amount %', NEW."amountMinor", v_orig."amountMinor";
    END IF;

    -- 9. Source linkage preservation
    IF NEW."khataPaymentId" IS DISTINCT FROM v_orig."khataPaymentId" OR
       NEW."allocationId"   IS DISTINCT FROM v_orig."allocationId" THEN
        RAISE EXCEPTION 'Source lineage mismatch between advance reversal % and original %', NEW."id", v_orig."id";
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_advance_reversal_integrity ON "khata_advance_entries";
CREATE TRIGGER trg_validate_advance_reversal_integrity
BEFORE INSERT ON "khata_advance_entries"
FOR EACH ROW
EXECUTE FUNCTION fn_validate_advance_reversal_integrity();

-- 11. SALE & STORE SCOPE CONSISTENCY TRIGGERS
-- When a Sale has a company assigned, it must agree with the Store's assigned company and currency.
CREATE OR REPLACE FUNCTION fn_validate_sale_store_scope_consistency()
RETURNS TRIGGER AS $$
DECLARE
    v_store RECORD;
BEGIN
    IF NEW."companyId" IS NOT NULL OR NEW."currencySnapshot" IS NOT NULL THEN
        SELECT "companyId", "currency" INTO v_store
        FROM "stores"
        WHERE "id" = NEW."storeId" AND "tenantId" = NEW."tenantId";

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Referenced store % does not exist in tenant %', NEW."storeId", NEW."tenantId";
        END IF;

        IF NEW."companyId" IS NOT NULL AND v_store."companyId" IS NOT NULL AND NEW."companyId" <> v_store."companyId" THEN
            RAISE EXCEPTION 'Sale company % does not match store company %', NEW."companyId", v_store."companyId";
        END IF;

        IF NEW."currencySnapshot" IS NOT NULL AND NEW."currencySnapshot" <> v_store."currency" THEN
            RAISE EXCEPTION 'Sale currency snapshot % does not match store currency %', NEW."currencySnapshot", v_store."currency";
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_sale_store_scope_consistency ON "sales";
CREATE TRIGGER trg_validate_sale_store_scope_consistency
BEFORE INSERT OR UPDATE OF "storeId", "companyId", "currencySnapshot" ON "sales"
FOR EACH ROW
EXECUTE FUNCTION fn_validate_sale_store_scope_consistency();

-- 11. ALLOCATION SCOPE CONSISTENCY TRIGGERS
-- Payment and advance allocations must match the Sale's assigned company, customer, and currency.
-- Fail-closed: The referenced Sale must have non-NULL companyId and currencySnapshot matching the allocation full scope.
CREATE OR REPLACE FUNCTION fn_validate_payment_allocation_sale_consistency()
RETURNS TRIGGER AS $$
DECLARE
    v_sale RECORD;
BEGIN
    SELECT "customerId", "companyId", "currencySnapshot" INTO v_sale
    FROM "sales"
    WHERE "id" = NEW."saleId" AND "tenantId" = NEW."tenantId";

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sale % not found under tenant %', NEW."saleId", NEW."tenantId";
    END IF;

    -- Fail-closed: Reject allocations against unmapped legacy sales
    IF v_sale."companyId" IS NULL THEN
        RAISE EXCEPTION 'Sale % has no legal Company assigned; cannot allocate payment %', NEW."saleId", NEW."id";
    END IF;

    IF v_sale."currencySnapshot" IS NULL THEN
        RAISE EXCEPTION 'Sale % has no currencySnapshot assigned; cannot allocate payment %', NEW."saleId", NEW."id";
    END IF;

    -- Exact full-scope parity enforcement
    IF v_sale."customerId" IS DISTINCT FROM NEW."customerId" THEN
        RAISE EXCEPTION 'Payment allocation customer % does not match sale customer %', NEW."customerId", v_sale."customerId";
    END IF;

    IF v_sale."companyId" <> NEW."companyId" THEN
        RAISE EXCEPTION 'Payment allocation company % does not match sale company %', NEW."companyId", v_sale."companyId";
    END IF;

    IF v_sale."currencySnapshot" <> NEW."currency" THEN
        RAISE EXCEPTION 'Payment allocation currency % does not match sale currency snapshot %', NEW."currency", v_sale."currencySnapshot";
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_payment_allocation_sale ON "khata_payment_allocations";
CREATE TRIGGER trg_validate_payment_allocation_sale
BEFORE INSERT ON "khata_payment_allocations"
FOR EACH ROW
EXECUTE FUNCTION fn_validate_payment_allocation_sale_consistency();

CREATE OR REPLACE FUNCTION fn_validate_advance_allocation_sale_consistency()
RETURNS TRIGGER AS $$
DECLARE
    v_sale RECORD;
BEGIN
    SELECT "customerId", "companyId", "currencySnapshot" INTO v_sale
    FROM "sales"
    WHERE "id" = NEW."saleId" AND "tenantId" = NEW."tenantId";

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Sale % not found under tenant %', NEW."saleId", NEW."tenantId";
    END IF;

    -- Fail-closed: Reject allocations against unmapped legacy sales
    IF v_sale."companyId" IS NULL THEN
        RAISE EXCEPTION 'Sale % has no legal Company assigned; cannot allocate advance %', NEW."saleId", NEW."id";
    END IF;

    IF v_sale."currencySnapshot" IS NULL THEN
        RAISE EXCEPTION 'Sale % has no currencySnapshot assigned; cannot allocate advance %', NEW."saleId", NEW."id";
    END IF;

    -- Exact full-scope parity enforcement
    IF v_sale."customerId" IS DISTINCT FROM NEW."customerId" THEN
        RAISE EXCEPTION 'Advance allocation customer % does not match sale customer %', NEW."customerId", v_sale."customerId";
    END IF;

    IF v_sale."companyId" <> NEW."companyId" THEN
        RAISE EXCEPTION 'Advance allocation company % does not match sale company %', NEW."companyId", v_sale."companyId";
    END IF;

    IF v_sale."currencySnapshot" <> NEW."currency" THEN
        RAISE EXCEPTION 'Advance allocation currency % does not match sale currency snapshot %', NEW."currency", v_sale."currencySnapshot";
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_validate_advance_allocation_sale ON "khata_advance_allocations";
CREATE TRIGGER trg_validate_advance_allocation_sale
BEFORE INSERT ON "khata_advance_allocations"
FOR EACH ROW
EXECUTE FUNCTION fn_validate_advance_allocation_sale_consistency();

-- 12. WRITE PATH GATE NOTE
-- Direct ledger posting routines (fn_post_khata_credit_sale) are intentionally deferred from Phase 1.
-- All on-account checkout write paths remain fail-closed at the application service gate.
-- The complete credit exposure gate (verifying creditLimitMinor, unallocated balances, overdue invoices,
-- phone verification, and transactional row locking) will be introduced in the subsequent phase alongside
-- authorized company assignment workflows.

