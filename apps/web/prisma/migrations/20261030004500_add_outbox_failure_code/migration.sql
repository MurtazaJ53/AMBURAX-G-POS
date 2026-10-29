-- AlterTable
ALTER TABLE "outbox_events" ADD COLUMN IF NOT EXISTS "failureCode" TEXT;

-- One-time backfill
UPDATE "outbox_events"
   SET "failureCode" = 'ERP_SITE_NOT_SET'
 WHERE "deadLetteredAt" IS NOT NULL
   AND "lastError" LIKE '%has no ERP site configured%';
