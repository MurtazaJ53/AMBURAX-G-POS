-- Owner's AI key (encrypted), supplier bill-text aliases, and history imported from older software.

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "aiKeyCipher" TEXT,
ADD COLUMN     "aiKeyLast4" TEXT;

-- CreateTable
CREATE TABLE "supplier_item_aliases" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_item_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imported_sales" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "billNumber" TEXT NOT NULL,
    "soldAt" TIMESTAMP(3) NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "totalMinor" INTEGER NOT NULL,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "paymentMode" TEXT,
    "itemsText" TEXT,
    "importBatchId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "imported_sales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "supplier_item_aliases_tenantId_supplierId_text_key" ON "supplier_item_aliases"("tenantId", "supplierId", "text");

-- CreateIndex
CREATE UNIQUE INDEX "imported_sales_tenantId_storeId_billNumber_key" ON "imported_sales"("tenantId", "storeId", "billNumber");

-- CreateIndex
CREATE INDEX "imported_sales_tenantId_customerId_idx" ON "imported_sales"("tenantId", "customerId");

-- CreateIndex
CREATE INDEX "imported_sales_tenantId_soldAt_idx" ON "imported_sales"("tenantId", "soldAt");
