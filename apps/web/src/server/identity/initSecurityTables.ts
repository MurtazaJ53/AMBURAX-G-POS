import { db } from "@/server/db";

async function ensureTables() {
  console.log("Checking and ensuring security tables...");
  
  await db.$executeRawUnsafe(`
    DO $$ BEGIN
      CREATE TYPE "LocationEnforcementMode" AS ENUM ('OFF', 'WARN', 'ENFORCE_STAFF_ONLY', 'ENFORCE_ALL');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;

    DO $$ BEGIN
      CREATE TYPE "SignInDecision" AS ENUM ('ALLOWED', 'ALLOWED_WITH_WARNING', 'ALLOWED_BREAK_GLASS', 'BLOCKED_CREDENTIALS', 'BLOCKED_UNTRUSTED_NETWORK', 'BLOCKED_GEO_POLICY', 'BLOCKED_LOCKED_ACCOUNT');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;

    DO $$ BEGIN
      CREATE TYPE "OutboxChannel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;

    DO $$ BEGIN
      CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'DEAD_LETTER');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;

    CREATE TABLE IF NOT EXISTS "user_security_preferences" (
      "user_id" TEXT PRIMARY KEY,
      "tenant_id" TEXT NOT NULL,
      "sign_in_alerts_enabled" BOOLEAN NOT NULL DEFAULT true,
      "alert_on_new_device_only" BOOLEAN NOT NULL DEFAULT true,
      "notify_email" BOOLEAN NOT NULL DEFAULT true,
      "notify_sms" BOOLEAN NOT NULL DEFAULT false,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "fk_user_security_preferences_user" FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS "known_devices" (
      "id" TEXT PRIMARY KEY,
      "tenant_id" TEXT NOT NULL,
      "user_id" TEXT NOT NULL,
      "device_hash" TEXT NOT NULL,
      "user_agent" TEXT NOT NULL,
      "device_kind" TEXT NOT NULL,
      "browser" TEXT,
      "os" TEXT,
      "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "last_ip" TEXT NOT NULL,
      CONSTRAINT "fk_known_devices_user" FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE CASCADE,
      CONSTRAINT "uq_known_devices_tenant_user_hash" UNIQUE ("tenant_id", "user_id", "device_hash")
    );

    CREATE TABLE IF NOT EXISTS "tenant_login_policies" (
      "tenant_id" TEXT PRIMARY KEY,
      "enforcement_mode" "LocationEnforcementMode" NOT NULL DEFAULT 'OFF',
      "allowed_countries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      "allow_vpn" BOOLEAN NOT NULL DEFAULT false,
      "updated_by_user_id" TEXT NOT NULL,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "fk_tenant_login_policies_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
      CONSTRAINT "fk_tenant_login_policies_updater" FOREIGN KEY ("updated_by_user_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS "trusted_networks" (
      "id" TEXT PRIMARY KEY,
      "tenant_id" TEXT NOT NULL,
      "store_id" TEXT,
      "label" TEXT NOT NULL,
      "cidr" TEXT NOT NULL,
      "ip_version" INTEGER NOT NULL DEFAULT 4,
      "created_by_user_id" TEXT NOT NULL,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "expires_at" TIMESTAMP(3),
      CONSTRAINT "fk_trusted_networks_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
      CONSTRAINT "fk_trusted_networks_store" FOREIGN KEY ("store_id", "tenant_id") REFERENCES "stores"("id", "tenant_id") ON DELETE CASCADE,
      CONSTRAINT "fk_trusted_networks_creator" FOREIGN KEY ("created_by_user_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS "break_glass_session_grants" (
      "id" TEXT PRIMARY KEY,
      "tenant_id" TEXT NOT NULL,
      "user_id" TEXT NOT NULL,
      "device_hash" TEXT NOT NULL,
      "ip_address" TEXT NOT NULL,
      "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "expires_at" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "fk_break_glass_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
      CONSTRAINT "fk_break_glass_user" FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS "sign_in_events" (
      "id" TEXT PRIMARY KEY,
      "tenant_id" TEXT NOT NULL,
      "user_id" TEXT,
      "email" TEXT NOT NULL,
      "ip" TEXT NOT NULL,
      "user_agent" TEXT,
      "country" TEXT,
      "city" TEXT,
      "decision" "SignInDecision" NOT NULL,
      "reason" TEXT,
      "device_hash" TEXT,
      "session_id" TEXT,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "fk_sign_in_events_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT,
      CONSTRAINT "fk_sign_in_events_user" FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS "security_notification_outbox" (
      "id" TEXT PRIMARY KEY,
      "tenant_id" TEXT NOT NULL,
      "user_id" TEXT NOT NULL,
      "channel" "OutboxChannel" NOT NULL,
      "destination" TEXT NOT NULL,
      "template_id" TEXT NOT NULL,
      "payload_cipher" TEXT NOT NULL,
      "idempotency_key" TEXT NOT NULL UNIQUE,
      "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
      "attempts" INTEGER NOT NULL DEFAULT 0,
      "max_attempts" INTEGER NOT NULL DEFAULT 5,
      "next_retry_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "locked_at" TIMESTAMP(3),
      "locked_by" TEXT,
      "last_error" TEXT,
      "provider_msg_id" TEXT,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "delivered_at" TIMESTAMP(3),
      CONSTRAINT "fk_security_outbox_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
      CONSTRAINT "fk_security_outbox_user" FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenant_id") ON DELETE CASCADE
    );
  `);

  console.log("Security tables verified and ready.");
}

ensureTables().catch(console.error);
