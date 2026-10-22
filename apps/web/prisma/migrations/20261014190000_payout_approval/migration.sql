-- E6: pay-out category, payee and approval.

-- AlterTable
ALTER TABLE "cash_movements" ADD COLUMN     "approvalLevel" TEXT,
ADD COLUMN     "approvedByUserId" TEXT,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "payee" TEXT;
