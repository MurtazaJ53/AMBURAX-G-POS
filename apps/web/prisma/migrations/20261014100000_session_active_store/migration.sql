-- A12 Store / Workspace Selection: the store a signed-in session works in. Nullable; a
-- session that never chose keeps today's default-store behaviour.
ALTER TABLE "sessions" ADD COLUMN "activeStoreId" TEXT;

ALTER TABLE "sessions" ADD CONSTRAINT "fk_session_active_store"
  FOREIGN KEY ("activeStoreId", "tenantId") REFERENCES "stores"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
