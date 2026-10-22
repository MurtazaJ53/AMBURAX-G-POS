-- E4: manager approval of till differences, and their ERPNext posting state.

-- AlterTable
ALTER TABLE "pos_sessions" ADD COLUMN     "varianceApprovalNote" TEXT,
ADD COLUMN     "varianceApprovedAt" TIMESTAMP(3),
ADD COLUMN     "varianceApprovedByUserId" TEXT,
ADD COLUMN     "varianceErpRef" TEXT,
ADD COLUMN     "variancePostingStatus" TEXT,
ADD COLUMN     "varianceStatus" TEXT;
