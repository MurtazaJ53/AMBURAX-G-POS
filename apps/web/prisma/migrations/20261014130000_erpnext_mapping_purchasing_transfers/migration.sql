-- ERPNext-first (owner rule 2026-10-14): mapping and sync status for suppliers, purchases,
-- supplier returns and transfers. Additive; generated with prisma migrate diff, known updatedAt
-- drifts left out.

-- AlterTable
ALTER TABLE "purchase_receipts" ADD COLUMN     "erpSyncStatus" "ErpSyncStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "erpnextName" TEXT;

-- AlterTable
ALTER TABLE "purchase_returns" ADD COLUMN     "erpSyncStatus" "ErpSyncStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "erpnextName" TEXT;

-- AlterTable
ALTER TABLE "stock_transfers" ADD COLUMN     "erpSyncStatus" "ErpSyncStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "erpnextReceiveEntry" TEXT,
ADD COLUMN     "erpnextSendEntry" TEXT;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "erpSyncStatus" "ErpSyncStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "erpnextName" TEXT;
