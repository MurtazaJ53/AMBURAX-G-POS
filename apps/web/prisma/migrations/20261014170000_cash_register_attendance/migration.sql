-- Screens 51, 53-54: staff check-ins, till float, cash pay-in/out, and close counts.
-- CreateEnum
CREATE TYPE "CashMovementKind" AS ENUM ('PAY_IN', 'PAY_OUT');

-- CreateEnum
CREATE TYPE "CheckinType" AS ENUM ('IN', 'OUT');

-- AlterTable
ALTER TABLE "pos_sessions" ADD COLUMN     "countedAt" TIMESTAMP(3),
ADD COLUMN     "countedByUserId" TEXT,
ADD COLUMN     "openingFloatMinor" INTEGER;

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" "CashMovementKind" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_counts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "expectedMinor" INTEGER NOT NULL,
    "countedMinor" INTEGER NOT NULL,
    "differenceMinor" INTEGER NOT NULL,

    CONSTRAINT "session_counts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_checkins" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "logType" "CheckinType" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_checkins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_movements_tenantId_sessionId_idx" ON "cash_movements"("tenantId", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "cash_movements_tenantId_idempotencyKey_key" ON "cash_movements"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "session_counts_sessionId_method_key" ON "session_counts"("sessionId", "method");

-- CreateIndex
CREATE INDEX "staff_checkins_tenantId_storeId_at_idx" ON "staff_checkins"("tenantId", "storeId", "at");

-- CreateIndex
CREATE INDEX "staff_checkins_tenantId_userId_at_idx" ON "staff_checkins"("tenantId", "userId", "at");

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "fk_cm_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "fk_cm_session" FOREIGN KEY ("sessionId", "tenantId") REFERENCES "pos_sessions"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_counts" ADD CONSTRAINT "fk_sc_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_counts" ADD CONSTRAINT "fk_sc_session" FOREIGN KEY ("sessionId", "tenantId") REFERENCES "pos_sessions"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_checkins" ADD CONSTRAINT "fk_ci_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_checkins" ADD CONSTRAINT "fk_ci_store" FOREIGN KEY ("storeId", "tenantId") REFERENCES "stores"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
