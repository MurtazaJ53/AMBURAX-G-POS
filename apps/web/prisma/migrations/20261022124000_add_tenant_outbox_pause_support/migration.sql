-- Migration: add_tenant_outbox_pause_support
-- Purpose: Allows pausing ERPNext sync for individual tenants (e.g. demo/load-test tenants or broken setups)
-- Non-breaking: defaults isSyncPaused to false for all tenants.

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "isSyncPaused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "syncPausedReason" TEXT;
