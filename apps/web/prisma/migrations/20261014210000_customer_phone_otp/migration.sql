-- Q9: customer phone verification by one-time code.

-- CreateTable
CREATE TABLE "customer_phone_challenges" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_phone_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_phone_challenges_tenantId_customerId_createdAt_idx" ON "customer_phone_challenges"("tenantId", "customerId", "createdAt");
