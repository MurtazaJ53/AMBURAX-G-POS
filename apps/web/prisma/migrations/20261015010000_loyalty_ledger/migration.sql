-- Decision 41: loyalty program (per tenant + currency) and append-only ledger. Earn/redeem stay off
-- until finance and the GST reviewer sign off.

-- CreateTable
CREATE TABLE "loyalty_programs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "name" TEXT NOT NULL DEFAULT 'Loyalty',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "pointsPerUnit" INTEGER NOT NULL DEFAULT 1,
    "earnUnitMinor" INTEGER NOT NULL DEFAULT 10000,
    "pointValueMinor" INTEGER NOT NULL DEFAULT 100,
    "expiryMonths" INTEGER NOT NULL DEFAULT 12,
    "minRedeemPoints" INTEGER NOT NULL DEFAULT 100,
    "maxRedeemBp" INTEGER NOT NULL DEFAULT 1000,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_ledger_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "points" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "saleId" TEXT,
    "returnId" TEXT,
    "sourceEntryId" TEXT,
    "allocations" JSONB,
    "idempotencyKey" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_programs_tenantId_currency_key" ON "loyalty_programs"("tenantId", "currency");

-- CreateIndex
CREATE INDEX "loyalty_ledger_entries_tenantId_customerId_expiresAt_idx" ON "loyalty_ledger_entries"("tenantId", "customerId", "expiresAt");

-- CreateIndex
CREATE INDEX "loyalty_ledger_entries_tenantId_saleId_idx" ON "loyalty_ledger_entries"("tenantId", "saleId");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_ledger_entries_tenantId_idempotencyKey_key" ON "loyalty_ledger_entries"("tenantId", "idempotencyKey");

-- Points can never be edited into a negative lot.
ALTER TABLE "loyalty_ledger_entries" ADD CONSTRAINT "loyalty_remaining_nonneg" CHECK ("remaining" >= 0);
