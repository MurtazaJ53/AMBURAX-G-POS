import { db } from "@/server/db";
import { logError } from "@/lib/safeLog";
import { isIpInCidr } from "@/server/security/clientIp";

let tablesInitialized = false;

async function ensureTablesExist() {
  if (tablesInitialized) return;
  try {
    const userCols = await db.$queryRawUnsafe<any[]>(`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'users';
    `);
    const colNames = userCols.map((c) => c.column_name);
    const tenantCol = colNames.includes("tenant_id") ? "tenant_id" : "tenantId";

    const statements = [
      `DO $$ BEGIN CREATE TYPE "LocationEnforcementMode" AS ENUM ('OFF', 'WARN', 'ENFORCE_STAFF_ONLY', 'ENFORCE_ALL'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
      `DO $$ BEGIN CREATE TYPE "SignInDecision" AS ENUM ('ALLOWED', 'ALLOWED_WITH_WARNING', 'ALLOWED_BREAK_GLASS', 'BLOCKED_CREDENTIALS', 'BLOCKED_UNTRUSTED_NETWORK', 'BLOCKED_GEO_POLICY', 'BLOCKED_LOCKED_ACCOUNT'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
      `DO $$ BEGIN CREATE TYPE "OutboxChannel" AS ENUM ('EMAIL', 'SMS', 'WHATSAPP'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
      `DO $$ BEGIN CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'DEAD_LETTER'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
      `CREATE TABLE IF NOT EXISTS "user_security_preferences" (
        "user_id" TEXT PRIMARY KEY,
        "tenant_id" TEXT NOT NULL,
        "sign_in_alerts_enabled" BOOLEAN NOT NULL DEFAULT true,
        "alert_on_new_device_only" BOOLEAN NOT NULL DEFAULT true,
        "notify_email" BOOLEAN NOT NULL DEFAULT true,
        "notify_sms" BOOLEAN NOT NULL DEFAULT false,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "fk_user_security_preferences_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      );`,
      `CREATE TABLE IF NOT EXISTS "known_devices" (
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
        CONSTRAINT "fk_known_devices_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "uq_known_devices_tenant_user_hash" UNIQUE ("tenant_id", "user_id", "device_hash")
      );`,
      `CREATE TABLE IF NOT EXISTS "tenant_login_policies" (
        "tenant_id" TEXT PRIMARY KEY,
        "enforcement_mode" "LocationEnforcementMode" NOT NULL DEFAULT 'OFF',
        "allowed_countries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        "allow_vpn" BOOLEAN NOT NULL DEFAULT false,
        "updated_by_user_id" TEXT NOT NULL,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "fk_tenant_login_policies_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_tenant_login_policies_updater" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
      );`,
      `CREATE TABLE IF NOT EXISTS "trusted_networks" (
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
        CONSTRAINT "fk_trusted_networks_creator" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT
      );`,
      `CREATE TABLE IF NOT EXISTS "break_glass_session_grants" (
        "id" TEXT PRIMARY KEY,
        "tenant_id" TEXT NOT NULL,
        "user_id" TEXT NOT NULL,
        "device_hash" TEXT NOT NULL,
        "ip_address" TEXT NOT NULL,
        "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "expires_at" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "fk_break_glass_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_break_glass_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      );`,
      `CREATE TABLE IF NOT EXISTS "sign_in_events" (
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
        CONSTRAINT "fk_sign_in_events_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT
      );`,
      `CREATE TABLE IF NOT EXISTS "security_notification_outbox" (
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
        CONSTRAINT "fk_security_outbox_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
      );`
    ];

    for (const stmt of statements) {
      await db.$executeRawUnsafe(stmt);
    }
    tablesInitialized = true;
  } catch (err) {
    logError("ensureTablesExist failed", err);
  }
}

export interface SecurityPreferencesView {
  signInAlertsEnabled: boolean;
  alertOnNewDeviceOnly: boolean;
  notifyEmail: boolean;
  notifySms: boolean;
}

export interface TenantLoginPolicyView {
  enforcementMode: "OFF" | "WARN" | "ENFORCE_STAFF_ONLY" | "ENFORCE_ALL";
  allowedCountries: string[];
  allowVpn: boolean;
  trustedNetworks: {
    id: string;
    label: string;
    cidr: string;
    storeId: string | null;
    createdAt: Date;
  }[];
}

export async function getSecurityOverview(params: {
  userId: string;
  tenantId: string;
}): Promise<{
  preferences: SecurityPreferencesView;
  policy: TenantLoginPolicyView;
}> {
  await ensureTablesExist();

  let prefsRows: any[] = [];
  try {
    prefsRows = await db.$queryRawUnsafe<any[]>(
      `SELECT * FROM "user_security_preferences" WHERE "user_id" = $1 LIMIT 1`,
      params.userId
    );
  } catch {
    prefsRows = [];
  }

  let prefs = prefsRows[0];
  if (!prefs) {
    try {
      await db.$executeRawUnsafe(
        `INSERT INTO "user_security_preferences" ("user_id", "tenant_id", "sign_in_alerts_enabled", "alert_on_new_device_only", "notify_email", "notify_sms")
         VALUES ($1, $2, true, true, true, false)
         ON CONFLICT ("user_id") DO NOTHING`,
        params.userId,
        params.tenantId
      );
      prefs = {
        sign_in_alerts_enabled: true,
        alert_on_new_device_only: true,
        notify_email: true,
        notify_sms: false,
      };
    } catch {
      prefs = {
        sign_in_alerts_enabled: true,
        alert_on_new_device_only: true,
        notify_email: true,
        notify_sms: false,
      };
    }
  }

  let policyRows: any[] = [];
  let networks: any[] = [];
  try {
    [policyRows, networks] = await Promise.all([
      db.$queryRawUnsafe<any[]>(
        `SELECT * FROM "tenant_login_policies" WHERE "tenant_id" = $1 LIMIT 1`,
        params.tenantId
      ),
      db.$queryRawUnsafe<any[]>(
        `SELECT * FROM "trusted_networks" WHERE "tenant_id" = $1 ORDER BY "created_at" DESC`,
        params.tenantId
      ),
    ]);
  } catch {
    policyRows = [];
    networks = [];
  }

  const policy = policyRows[0];

  return {
    preferences: {
      signInAlertsEnabled: prefs.sign_in_alerts_enabled ?? true,
      alertOnNewDeviceOnly: prefs.alert_on_new_device_only ?? true,
      notifyEmail: prefs.notify_email ?? true,
      notifySms: prefs.notify_sms ?? false,
    },
    policy: {
      enforcementMode: policy?.enforcement_mode ?? "OFF",
      allowedCountries: policy?.allowed_countries ?? [],
      allowVpn: policy?.allow_vpn ?? false,
      trustedNetworks: networks.map((n) => ({
        id: n.id,
        label: n.label,
        cidr: n.cidr,
        storeId: n.store_id,
        createdAt: n.created_at,
      })),
    },
  };
}

export async function updateSecurityPreferences(params: {
  userId: string;
  tenantId: string;
  signInAlertsEnabled: boolean;
  alertOnNewDeviceOnly: boolean;
  notifyEmail: boolean;
  notifySms: boolean;
}) {
  await ensureTablesExist();
  return db.$executeRawUnsafe(
    `INSERT INTO "user_security_preferences" ("user_id", "tenant_id", "sign_in_alerts_enabled", "alert_on_new_device_only", "notify_email", "notify_sms", "updated_at")
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT ("user_id") DO UPDATE
     SET "sign_in_alerts_enabled" = EXCLUDED."sign_in_alerts_enabled",
         "alert_on_new_device_only" = EXCLUDED."alert_on_new_device_only",
         "notify_email" = EXCLUDED."notify_email",
         "notify_sms" = EXCLUDED."notify_sms",
         "updated_at" = NOW()`,
    params.userId,
    params.tenantId,
    params.signInAlertsEnabled,
    params.alertOnNewDeviceOnly,
    params.notifyEmail,
    params.notifySms
  );
}

export async function updateTenantPolicyMode(params: {
  tenantId: string;
  userId: string;
  enforcementMode: "OFF" | "WARN" | "ENFORCE_STAFF_ONLY" | "ENFORCE_ALL";
}) {
  await ensureTablesExist();
  return db.$executeRawUnsafe(
    `INSERT INTO "tenant_login_policies" ("tenant_id", "enforcement_mode", "updated_by_user_id", "updated_at")
     VALUES ($1, $2::"LocationEnforcementMode", $3, NOW())
     ON CONFLICT ("tenant_id") DO UPDATE
     SET "enforcement_mode" = EXCLUDED."enforcement_mode",
         "updated_by_user_id" = EXCLUDED."updated_by_user_id",
         "updated_at" = NOW()`,
    params.tenantId,
    params.enforcementMode,
    params.userId
  );
}

export async function addTrustedNetwork(params: {
  tenantId: string;
  userId: string;
  label: string;
  cidr: string;
  storeId?: string | null;
}) {
  await ensureTablesExist();
  const id = `tn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return db.$executeRawUnsafe(
    `INSERT INTO "trusted_networks" ("id", "tenant_id", "store_id", "label", "cidr", "ip_version", "created_by_user_id", "created_at")
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    id,
    params.tenantId,
    params.storeId ?? null,
    params.label,
    params.cidr,
    params.cidr.includes(":") ? 6 : 4,
    params.userId
  );
}

export async function removeTrustedNetwork(params: {
  tenantId: string;
  id: string;
}) {
  await ensureTablesExist();
  return db.$executeRawUnsafe(
    `DELETE FROM "trusted_networks" WHERE "id" = $1 AND "tenant_id" = $2`,
    params.id,
    params.tenantId
  );
}
