import { db } from "@/server/db";
import { isIpInCidr } from "@/server/security/clientIp";

// The security tables and enums are created by the Prisma migration
// 20261020040000_sign_in_security. Nothing here creates or alters schema at runtime.

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
  return db.$executeRawUnsafe(
    `DELETE FROM "trusted_networks" WHERE "id" = $1 AND "tenant_id" = $2`,
    params.id,
    params.tenantId
  );
}
