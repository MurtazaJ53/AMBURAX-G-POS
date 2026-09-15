-- Retail/POS backend — the POS session foundation.
--
-- Additive and non-destructive: one new table, two new nullable columns, four composite foreign
-- keys. Nothing is dropped, no data is rewritten, and no backfill is needed — sessions start
-- empty and every existing sale keeps a null session, which is the truthful value for a sale
-- rung up before tills had shifts.
--
-- What this adds, and why each piece exists:
--
--   * `pos_sessions` — a cashier's shift on one till. A POS device is hardware, a User is a
--     person, a Store is a place and a Sale is one transaction; the shift is the span that ties
--     them together, and a retail backend cannot answer "which till, whose shift" without it.
--
--   * `pos_devices.activeSessionId` — a pointer to the one shift currently open on that till.
--     A column holds exactly one value, so "two shifts open on one till" is not a state the
--     database can represent. The alternative, a partial unique index over an `isOpen` flag, is
--     something Prisma cannot express without permanent drift.
--
--   * `sales.posSessionId` — which shift rang a sale up. Nullable because sales predating this
--     model exist and a back-office sale has no till.
--
-- What this deliberately does NOT add: any cash-drawer concept. No opening float, no counted
-- total, no variance, no reconciliation. None of that has been designed, and a half-modelled
-- cash drawer is worse than none because it invites people to trust a number nobody computed.
--
-- Every foreign key is composite `(childId, tenantId) -> parent(id, tenantId)`, so PostgreSQL
-- refuses a session on another tenant's till, in another tenant's store, run by another tenant's
-- cashier, and refuses a sale attributed to another tenant's shift.

-- AlterTable
ALTER TABLE "pos_devices" ADD COLUMN     "activeSessionId" TEXT;

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "posSessionId" TEXT;

-- CreateTable
CREATE TABLE "pos_sessions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "posDeviceId" TEXT NOT NULL,
    "cashierUserId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closingNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pos_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pos_sessions_tenantId_storeId_openedAt_idx" ON "pos_sessions"("tenantId", "storeId", "openedAt");

-- CreateIndex
CREATE INDEX "pos_sessions_posDeviceId_openedAt_idx" ON "pos_sessions"("posDeviceId", "openedAt");

-- CreateIndex
CREATE UNIQUE INDEX "pos_sessions_id_tenantId_key" ON "pos_sessions"("id", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "pos_devices_activeSessionId_key" ON "pos_devices"("activeSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "pos_devices_id_tenantId_key" ON "pos_devices"("id", "tenantId");

-- AddForeignKey
ALTER TABLE "pos_devices" ADD CONSTRAINT "pos_devices_activeSessionId_tenantId_fkey" FOREIGN KEY ("activeSessionId", "tenantId") REFERENCES "pos_sessions"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_posSessionId_tenantId_fkey" FOREIGN KEY ("posSessionId", "tenantId") REFERENCES "pos_sessions"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sessions" ADD CONSTRAINT "pos_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sessions" ADD CONSTRAINT "pos_sessions_storeId_tenantId_fkey" FOREIGN KEY ("storeId", "tenantId") REFERENCES "stores"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sessions" ADD CONSTRAINT "pos_sessions_posDeviceId_tenantId_fkey" FOREIGN KEY ("posDeviceId", "tenantId") REFERENCES "pos_devices"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_sessions" ADD CONSTRAINT "pos_sessions_cashierUserId_tenantId_fkey" FOREIGN KEY ("cashierUserId", "tenantId") REFERENCES "users"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

