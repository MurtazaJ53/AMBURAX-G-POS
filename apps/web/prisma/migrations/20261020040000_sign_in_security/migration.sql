-- CreateEnum
CREATE TYPE "LocationEnforcementMode" AS ENUM ('OFF', 'WARN', 'ENFORCE_STAFF_ONLY', 'ENFORCE_ALL');

-- CreateEnum
CREATE TYPE "SignInDecision" AS ENUM ('ALLOWED', 'ALLOWED_WITH_WARNING', 'ALLOWED_BREAK_GLASS', 'BLOCKED_CREDENTIALS', 'BLOCKED_UNTRUSTED_NETWORK', 'BLOCKED_GEO_POLICY', 'BLOCKED_LOCKED_ACCOUNT');

-- CreateEnum
CREATE TYPE "OutboxChannel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'DEAD_LETTER');

-- AlterTable
ALTER TABLE "companies" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "customer_credit_accounts" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "khata_payments" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "sale_returns" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "user_security_preferences" (
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sign_in_alerts_enabled" BOOLEAN NOT NULL DEFAULT true,
    "alert_on_new_device_only" BOOLEAN NOT NULL DEFAULT true,
    "notify_email" BOOLEAN NOT NULL DEFAULT true,
    "notify_sms" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_security_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "known_devices" (
    "id" TEXT NOT NULL,
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

    CONSTRAINT "known_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_login_policies" (
    "tenant_id" TEXT NOT NULL,
    "enforcement_mode" "LocationEnforcementMode" NOT NULL DEFAULT 'OFF',
    "allowed_countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allow_vpn" BOOLEAN NOT NULL DEFAULT false,
    "updated_by_user_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_login_policies_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "trusted_networks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT,
    "label" TEXT NOT NULL,
    "cidr" TEXT NOT NULL,
    "ip_version" INTEGER NOT NULL DEFAULT 4,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),

    CONSTRAINT "trusted_networks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "break_glass_session_grants" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_hash" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "break_glass_session_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sign_in_events" (
    "id" TEXT NOT NULL,
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

    CONSTRAINT "sign_in_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_notification_outbox" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "channel" "OutboxChannel" NOT NULL,
    "destination" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "payload_cipher" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
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

    CONSTRAINT "security_notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_security_preferences_tenant_id_idx" ON "user_security_preferences"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_security_preferences_user_id_tenant_id_key" ON "user_security_preferences"("user_id", "tenant_id");

-- CreateIndex
CREATE INDEX "known_devices_tenant_id_user_id_idx" ON "known_devices"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "known_devices_tenant_id_user_id_device_hash_key" ON "known_devices"("tenant_id", "user_id", "device_hash");

-- CreateIndex
CREATE INDEX "trusted_networks_tenant_id_store_id_idx" ON "trusted_networks"("tenant_id", "store_id");

-- CreateIndex
CREATE INDEX "break_glass_session_grants_tenant_id_user_id_device_hash_idx" ON "break_glass_session_grants"("tenant_id", "user_id", "device_hash");

-- CreateIndex
CREATE INDEX "sign_in_events_tenant_id_created_at_idx" ON "sign_in_events"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "sign_in_events_tenant_id_user_id_created_at_idx" ON "sign_in_events"("tenant_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "sign_in_events_ip_created_at_idx" ON "sign_in_events"("ip", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "security_notification_outbox_idempotency_key_key" ON "security_notification_outbox"("idempotency_key");

-- CreateIndex
CREATE INDEX "security_notification_outbox_status_next_retry_at_idx" ON "security_notification_outbox"("status", "next_retry_at");

-- AddForeignKey
ALTER TABLE "user_security_preferences" ADD CONSTRAINT "user_security_preferences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_security_preferences" ADD CONSTRAINT "user_security_preferences_user_id_tenant_id_fkey" FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "known_devices" ADD CONSTRAINT "known_devices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "known_devices" ADD CONSTRAINT "known_devices_user_id_tenant_id_fkey" FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_login_policies" ADD CONSTRAINT "tenant_login_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_login_policies" ADD CONSTRAINT "tenant_login_policies_updated_by_user_id_tenant_id_fkey" FOREIGN KEY ("updated_by_user_id", "tenant_id") REFERENCES "users"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trusted_networks" ADD CONSTRAINT "trusted_networks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trusted_networks" ADD CONSTRAINT "trusted_networks_store_id_tenant_id_fkey" FOREIGN KEY ("store_id", "tenant_id") REFERENCES "stores"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trusted_networks" ADD CONSTRAINT "trusted_networks_created_by_user_id_tenant_id_fkey" FOREIGN KEY ("created_by_user_id", "tenant_id") REFERENCES "users"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_glass_session_grants" ADD CONSTRAINT "break_glass_session_grants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "break_glass_session_grants" ADD CONSTRAINT "break_glass_session_grants_user_id_tenant_id_fkey" FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sign_in_events" ADD CONSTRAINT "sign_in_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sign_in_events" ADD CONSTRAINT "sign_in_events_user_id_tenant_id_fkey" FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_notification_outbox" ADD CONSTRAINT "security_notification_outbox_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_notification_outbox" ADD CONSTRAINT "security_notification_outbox_user_id_tenant_id_fkey" FOREIGN KEY ("user_id", "tenant_id") REFERENCES "users"("id", "tenantId") ON DELETE CASCADE ON UPDATE CASCADE;

