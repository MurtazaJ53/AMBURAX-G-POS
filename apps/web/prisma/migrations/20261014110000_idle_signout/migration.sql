-- A13 "Sign out when idle": a per-user idle limit and a per-session last-seen time.
ALTER TABLE "users" ADD COLUMN "idleTimeoutMinutes" INTEGER;
ALTER TABLE "sessions" ADD COLUMN "lastSeenAt" TIMESTAMP(3);

ALTER TABLE "users" ADD CONSTRAINT "users_idle_timeout_check"
  CHECK ("idleTimeoutMinutes" IS NULL OR "idleTimeoutMinutes" BETWEEN 5 AND 1440);
