-- CreateTable
CREATE TABLE "held_bills" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "heldByUserId" TEXT NOT NULL,
    "posSessionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resumedAt" TIMESTAMP(3),
    "resumedByUserId" TEXT,
    "discardedAt" TIMESTAMP(3),
    "discardedByUserId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "held_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "held_bill_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "heldBillId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "held_bill_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "held_bills_tenantId_storeId_createdAt_idx" ON "held_bills"("tenantId", "storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "held_bills_id_tenantId_key" ON "held_bills"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "held_bills_tenantId_idempotencyKey_key" ON "held_bills"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "held_bill_items_tenantId_heldBillId_idx" ON "held_bill_items"("tenantId", "heldBillId");

-- CreateIndex
CREATE UNIQUE INDEX "held_bill_items_heldBillId_variantId_key" ON "held_bill_items"("heldBillId", "variantId");

-- AddForeignKey
ALTER TABLE "held_bills" ADD CONSTRAINT "held_bills_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "held_bills" ADD CONSTRAINT "held_bills_storeId_tenantId_fkey" FOREIGN KEY ("storeId", "tenantId") REFERENCES "stores"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "held_bills" ADD CONSTRAINT "held_bills_heldByUserId_tenantId_fkey" FOREIGN KEY ("heldByUserId", "tenantId") REFERENCES "users"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "held_bills" ADD CONSTRAINT "held_bills_resumedByUserId_tenantId_fkey" FOREIGN KEY ("resumedByUserId", "tenantId") REFERENCES "users"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "held_bills" ADD CONSTRAINT "held_bills_discardedByUserId_tenantId_fkey" FOREIGN KEY ("discardedByUserId", "tenantId") REFERENCES "users"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "held_bills" ADD CONSTRAINT "held_bills_posSessionId_tenantId_fkey" FOREIGN KEY ("posSessionId", "tenantId") REFERENCES "pos_sessions"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "held_bill_items" ADD CONSTRAINT "held_bill_items_heldBillId_tenantId_fkey" FOREIGN KEY ("heldBillId", "tenantId") REFERENCES "held_bills"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "held_bill_items" ADD CONSTRAINT "held_bill_items_variantId_tenantId_fkey" FOREIGN KEY ("variantId", "tenantId") REFERENCES "product_variants"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
