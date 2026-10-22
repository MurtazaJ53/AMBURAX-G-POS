-- E4: finance-supplied ERPNext accounts for till differences.

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "erpCashAccount" TEXT,
ADD COLUMN     "erpCashOverShortAccount" TEXT;
