-- E5: attendance rules per store, punch corrections, shift planning.

-- AlterTable
ALTER TABLE "staff_checkins" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'PUNCH',
ADD COLUMN     "voidedByCorrectionId" TEXT;

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "halfDayPercent" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "lateGraceMinutes" INTEGER NOT NULL DEFAULT 10;

-- CreateTable
CREATE TABLE "shift_plans" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "publishedByUserId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "changedAfterPublishAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "punch_corrections" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "originalCheckinId" TEXT,
    "logType" "CheckinType" NOT NULL,
    "correctedAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "appliedCheckinId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "punch_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shift_plans_tenantId_storeId_startAt_idx" ON "shift_plans"("tenantId", "storeId", "startAt");

-- CreateIndex
CREATE INDEX "shift_plans_tenantId_userId_startAt_idx" ON "shift_plans"("tenantId", "userId", "startAt");

-- CreateIndex
CREATE INDEX "punch_corrections_tenantId_storeId_status_idx" ON "punch_corrections"("tenantId", "storeId", "status");
