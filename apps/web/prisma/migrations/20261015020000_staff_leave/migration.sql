-- E5: leave / unavailability checked by shift planning.

-- CreateTable
CREATE TABLE "staff_leaves" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'LEAVE',
    "fromDate" TEXT NOT NULL,
    "toDate" TEXT NOT NULL,
    "halfDay" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedByUserId" TEXT NOT NULL,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_leaves_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_leaves_tenantId_userId_fromDate_idx" ON "staff_leaves"("tenantId", "userId", "fromDate");

-- CreateIndex
CREATE INDEX "staff_leaves_tenantId_storeId_status_idx" ON "staff_leaves"("tenantId", "storeId", "status");

ALTER TABLE "staff_leaves" ADD CONSTRAINT "staff_leaves_dates" CHECK ("fromDate" <= "toDate");
