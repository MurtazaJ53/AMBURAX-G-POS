-- Supplier EAN-8 codes get their own barcode type.
ALTER TYPE "BarcodeType" ADD VALUE IF NOT EXISTS 'EAN8';

-- Per-tenant counter for generated in-store EAN-13 barcodes ("21" + 10-digit number + check digit).
CREATE TABLE "tenant_barcode_sequences" (
    "tenantId" TEXT NOT NULL,
    "lastValue" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_barcode_sequences_pkey" PRIMARY KEY ("tenantId")
);

ALTER TABLE "tenant_barcode_sequences" ADD CONSTRAINT "tenant_barcode_sequences_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
