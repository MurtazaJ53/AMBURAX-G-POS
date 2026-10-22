-- Screen 36: stock reservations (confirmed orders, 15-minute checkout holds).
-- CreateEnum
CREATE TYPE "ReservationSource" AS ENUM ('ORDER', 'CHECKOUT');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED');

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "source" "ReservationSource" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "reviewAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_reservations_tenantId_storeId_variantId_status_idx" ON "stock_reservations"("tenantId", "storeId", "variantId", "status");

-- CreateIndex
CREATE INDEX "stock_reservations_tenantId_source_sourceId_idx" ON "stock_reservations"("tenantId", "source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_reservations_tenantId_idempotencyKey_key" ON "stock_reservations"("tenantId", "idempotencyKey");
