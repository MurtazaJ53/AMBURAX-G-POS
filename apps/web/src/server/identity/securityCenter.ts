import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { writeAuditLog } from "@/server/identity/audit";
import { hashPassword, verifyPassword } from "@/server/identity/password";
import { validatePasswordStrength } from "@/server/identity/passwordPolicy";

/**
 * A13 Security Settings and A14 Sessions / Devices — the signed-in user's own account only.
 *
 * Every function is scoped by (userId, tenantId) taken from the caller's session, never from
 * the request, so a user can only ever see or revoke their own sessions. No token, token hash
 * or secret is ever returned: a session is identified to the UI by its row id alone.
 */

/** Whether one-time codes reach a real inbox or phone. Today only the console stand-in exists. */
export function codeDeliveryIsLive(): boolean {
  return false;
}

/** Turning on two-step sign-in without a real code channel would lock the account out. */
export function canEnableMfa(): boolean {
  return codeDeliveryIsLive() || process.env.NODE_ENV !== "production";
}

export interface DeviceLabel {
  kind: "desktop" | "mobile" | "tablet" | "unknown";
  label: string;
}

/** A readable device name from a User-Agent string. Best effort; never trusted for security. */
export function describeUserAgent(ua: string | null | undefined): DeviceLabel {
  if (!ua) return { kind: "unknown", label: "Unknown device" };
  const os = /iPad/.test(ua)
    ? "iPad"
    : /iPhone/.test(ua)
      ? "iPhone"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : /curl|node|undici|axios/i.test(ua)
              ? "Script"
              : null;
  const kind: DeviceLabel["kind"] =
    os === "iPad" || (/Android/.test(ua) && !/Mobile/.test(ua))
      ? "tablet"
      : os === "iPhone" || /Mobile/.test(ua)
        ? "mobile"
        : os
          ? "desktop"
          : "unknown";
  const label = [os, browser].filter(Boolean).join(" – ") || "Unknown device";
  return { kind, label };
}

export interface ActiveSession {
  id: string;
  device: DeviceLabel;
  ip: string | null;
  createdAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
  storeName: string | null;
}

export async function listActiveSessions(params: {
  userId: string;
  tenantId: string;
  currentSessionId: string;
  now?: Date;
}): Promise<ActiveSession[]> {
  const now = params.now ?? new Date();
  const rows = await db.session.findMany({
    where: { userId: params.userId, tenantId: params.tenantId, revokedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      ip: true,
      userAgent: true,
      createdAt: true,
      expiresAt: true,
      activeStore: { select: { name: true } },
    },
  });
  return rows
    .map((r) => ({
      id: r.id,
      device: describeUserAgent(r.userAgent),
      ip: r.ip,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      isCurrent: r.id === params.currentSessionId,
      storeName: r.activeStore?.name ?? null,
    }))
    .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
}

/** Sign out one of the user's own sessions. Revoking the current one signs this device out. */
export async function revokeOwnSession(params: {
  userId: string;
  tenantId: string;
  sessionId: string;
}): Promise<{ status: "ok" } | { status: "not_found" }> {
  const res = await db.session.updateMany({
    where: { id: params.sessionId, userId: params.userId, tenantId: params.tenantId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (res.count === 0) return { status: "not_found" };
  await writeAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    action: "SessionRevoked",
    correlationId: randomUUID(),
    metadata: { sessionId: params.sessionId, by: "user" },
  });
  return { status: "ok" };
}

/** Sign out every other device, keeping this one. */
export async function revokeOtherSessions(params: {
  userId: string;
  tenantId: string;
  keepSessionId: string;
}): Promise<{ revoked: number }> {
  const res = await db.session.updateMany({
    where: {
      userId: params.userId,
      tenantId: params.tenantId,
      revokedAt: null,
      id: { not: params.keepSessionId },
    },
    data: { revokedAt: new Date() },
  });
  await writeAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    action: "OtherSessionsRevoked",
    correlationId: randomUUID(),
    metadata: { revoked: res.count },
  });
  return { revoked: res.count };
}

export interface SecurityEvent {
  kind: "login_ok" | "login_failed" | "signed_out" | "password_changed" | "mfa_changed" | "store_switched";
  label: string;
  at: Date;
  ip: string | null;
}

const AUDIT_EVENTS: Record<string, { kind: SecurityEvent["kind"]; label: string }> = {
  SessionRevoked: { kind: "signed_out", label: "Signed out" },
  OtherSessionsRevoked: { kind: "signed_out", label: "Signed out of other devices" },
  AllSessionsRevokedAfterPasswordReset: { kind: "signed_out", label: "All devices signed out after password reset" },
  PasswordChanged: { kind: "password_changed", label: "Password changed" },
  MfaEnabled: { kind: "mfa_changed", label: "Two-step sign-in turned on" },
  MfaDisabled: { kind: "mfa_changed", label: "Two-step sign-in turned off" },
  ContextChanged: { kind: "store_switched", label: "Switched store" },
};

/** Recent sign-ins (with IP) and security changes, newest first. */
export async function recentSecurityActivity(params: {
  userId: string;
  tenantId: string;
  email: string;
  limit?: number;
}): Promise<SecurityEvent[]> {
  const limit = Math.min(params.limit ?? 10, 50);
  const [attempts, audits] = await Promise.all([
    db.loginAttempt.findMany({
      where: { email: params.email.toLowerCase(), context: "password" },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { success: true, ip: true, createdAt: true },
    }),
    db.auditLog.findMany({
      where: { userId: params.userId, tenantId: params.tenantId, action: { in: Object.keys(AUDIT_EVENTS) } },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { action: true, createdAt: true },
    }),
  ]);
  const events: SecurityEvent[] = [
    ...attempts.map((a) => ({
      kind: a.success ? ("login_ok" as const) : ("login_failed" as const),
      label: a.success ? "Successful sign-in" : "Failed sign-in attempt",
      at: a.createdAt,
      ip: a.ip,
    })),
    ...audits.map((a) => ({ ...AUDIT_EVENTS[a.action]!, at: a.createdAt, ip: null })),
  ];
  return events.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

export type ChangePasswordResult =
  | { status: "ok"; signedOutOthers: number }
  | { status: "wrong_password" }
  | { status: "weak_password"; reason: string }
  | { status: "same_password" };

/** Change the password, then sign out every other device (keep this one). */
export async function changeOwnPassword(params: {
  userId: string;
  tenantId: string;
  currentSessionId: string;
  currentPassword: string;
  newPassword: string;
}): Promise<ChangePasswordResult> {
  const user = await db.user.findFirst({
    where: { id: params.userId, tenantId: params.tenantId },
    select: { passwordHash: true },
  });
  if (!user || !(await verifyPassword(params.currentPassword, user.passwordHash))) return { status: "wrong_password" };
  const strength = validatePasswordStrength(params.newPassword);
  if (!strength.ok) return { status: "weak_password", reason: strength.reason };
  if (await verifyPassword(params.newPassword, user.passwordHash)) return { status: "same_password" };

  await db.user.update({ where: { id: params.userId }, data: { passwordHash: await hashPassword(params.newPassword) } });
  await writeAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    action: "PasswordChanged",
    correlationId: randomUUID(),
    metadata: { via: "security_settings" },
  });
  const { revoked } = await revokeOtherSessions({
    userId: params.userId,
    tenantId: params.tenantId,
    keepSessionId: params.currentSessionId,
  });
  return { status: "ok", signedOutOthers: revoked };
}

export type SetMfaResult =
  | { status: "ok"; enabled: boolean }
  | { status: "wrong_password" }
  | { status: "delivery_unavailable" };

/** Turn two-step sign-in on or off for the user's own account, confirmed by their password. */
export async function setOwnMfa(params: {
  userId: string;
  tenantId: string;
  password: string;
  enabled: boolean;
}): Promise<SetMfaResult> {
  if (params.enabled && !canEnableMfa()) return { status: "delivery_unavailable" };
  const user = await db.user.findFirst({
    where: { id: params.userId, tenantId: params.tenantId },
    select: { passwordHash: true },
  });
  if (!user || !(await verifyPassword(params.password, user.passwordHash))) return { status: "wrong_password" };
  await db.user.update({ where: { id: params.userId }, data: { mfaEnabled: params.enabled } });
  await writeAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    action: params.enabled ? "MfaEnabled" : "MfaDisabled",
    correlationId: randomUUID(),
  });
  return { status: "ok", enabled: params.enabled };
}

/** The idle limits a user can pick (A13), in minutes. Null means off. */
export const IDLE_TIMEOUT_OPTIONS = [15, 30, 60, 120, 240] as const;

export async function setOwnIdleTimeout(params: {
  userId: string;
  tenantId: string;
  minutes: number | null;
}): Promise<{ status: "ok" } | { status: "invalid" }> {
  if (params.minutes !== null && !(IDLE_TIMEOUT_OPTIONS as readonly number[]).includes(params.minutes)) {
    return { status: "invalid" };
  }
  const res = await db.user.updateMany({
    where: { id: params.userId, tenantId: params.tenantId },
    data: { idleTimeoutMinutes: params.minutes },
  });
  if (res.count === 0) return { status: "invalid" };
  await writeAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    action: "IdleTimeoutChanged",
    correlationId: randomUUID(),
    metadata: { minutes: params.minutes },
  });
  return { status: "ok" };
}

export interface AuditEntry {
  id: string;
  action: string;
  label: string;
  actorName: string | null;
  at: Date;
}

/** Turn "StockReceived" or "supplier.created" into "Stock received" / "Supplier created". */
export function humanizeAction(action: string): string {
  const words = action
    .replace(/[._]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\bMfa\b|\bMFA\b/g, "two-step sign-in")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const AUDIT_PAGE_SIZE = 50;

/**
 * The audit log explorer (A13 "Audit logs"). The tenant OWNER sees every entry of their business;
 * anyone else sees only what they did themselves. Newest first, keyset-paged by timestamp.
 */
export async function listAuditEntries(params: {
  tenantId: string;
  userId: string;
  tenantRole: "OWNER" | "STAFF";
  before?: Date | null;
  limit?: number;
}): Promise<{ entries: AuditEntry[]; nextBefore: Date | null }> {
  const limit = Math.min(params.limit ?? AUDIT_PAGE_SIZE, 100);
  const rows = await db.auditLog.findMany({
    where: {
      tenantId: params.tenantId,
      ...(params.tenantRole === "OWNER" ? {} : { userId: params.userId }),
      ...(params.before ? { createdAt: { lt: params.before } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    select: { id: true, action: true, createdAt: true, userId: true },
  });
  const page = rows.slice(0, limit);
  const userIds = [...new Set(page.map((r) => r.userId).filter((v): v is string => Boolean(v)))];
  const users = userIds.length
    ? await db.user.findMany({ where: { id: { in: userIds }, tenantId: params.tenantId }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));
  return {
    entries: page.map((r) => ({
      id: r.id,
      action: r.action,
      label: humanizeAction(r.action),
      actorName: r.userId ? (nameById.get(r.userId) ?? null) : null,
      at: r.createdAt,
    })),
    nextBefore: rows.length > limit ? page[page.length - 1]!.createdAt : null,
  };
}
