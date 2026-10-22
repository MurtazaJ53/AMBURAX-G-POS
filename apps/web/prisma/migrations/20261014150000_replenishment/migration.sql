-- Screen 32: reorder levels (mirror ERPNext Item Reorder) and replenishment requests (ERPNext Material Request).

-- CreateTable
CREATE TABLE "reorder_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "reorderLevel" INTEGER NOT NULL,
    "reorderQty" INTEGER NOT NULL,
    "erpSyncStatus" "ErpSyncStatus" NOT NULL DEFAULT 'PENDING',
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reorder_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replenishment_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "note" TEXT,
    "erpnextName" TEXT,
    "erpSyncStatus" "ErpSyncStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "replenishment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replenishment_request_lines" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "replenishment_request_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reorder_rules_tenantId_storeId_variantId_key" ON "reorder_rules"("tenantId", "storeId", "variantId");

-- CreateIndex
CREATE INDEX "replenishment_requests_tenantId_storeId_createdAt_idx" ON "replenishment_requests"("tenantId", "storeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "replenishment_requests_tenantId_idempotencyKey_key" ON "replenishment_requests"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "uq_rq_id_tenant" ON "replenishment_requests"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "reorder_rules" ADD CONSTRAINT "fk_rr_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reorder_rules" ADD CONSTRAINT "fk_rr_store" FOREIGN KEY ("storeId", "tenantId") REFERENCES "stores"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reorder_rules" ADD CONSTRAINT "fk_rr_variant" FOREIGN KEY ("variantId", "tenantId") REFERENCES "product_variants"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replenishment_requests" ADD CONSTRAINT "fk_rq_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replenishment_requests" ADD CONSTRAINT "fk_rq_store" FOREIGN KEY ("storeId", "tenantId") REFERENCES "stores"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replenishment_request_lines" ADD CONSTRAINT "fk_rql_request" FOREIGN KEY ("requestId", "tenantId") REFERENCES "replenishment_requests"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "replenishment_request_lines" ADD CONSTRAINT "fk_rql_variant" FOREIGN KEY ("variantId", "tenantId") REFERENCES "product_variants"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
