import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, resetDatabase, seedTwoTenants, IDS } from "./db";
import { createSession, resolveSession } from "@/server/identity/session";
import { hashPassword, verifyPassword } from "@/server/identity/password";
import { resolvePosContext } from "@/server/sales/posContext";
import { canAccessStore, listAvailableStores, selectActiveStore } from "@/server/tenant/storeSelection";
import {
  changeOwnPassword,
  describeUserAgent,
  listActiveSessions,
  recentSecurityActivity,
  revokeOtherSessions,
  revokeOwnSession,
  setOwnMfa,
  setOwnIdleTimeout,
  listAuditEntries,
} from "@/server/identity/securityCenter";

// Real bcryptjs at cost 12 runs several times per test here. On a busy machine during the full run
// that can pass the 30 s default; alone these tests finish in seconds. Same headroom the
// bcrypt-backed unit suites got in dbf1ba4. The hashing cost itself is not lowered.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

/** A12 Store selection, A13 Security settings, A14 Sessions/devices — against real PostgreSQL. */

const STORE_A2 = "s-aaaaaaaaaaaaaaaaaaaaaaa2";
const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  const storeA = await db.store.findUniqueOrThrow({ where: { id: IDS.storeA } });
  await db.store.create({
    data: {
      id: STORE_A2,
      tenantId: IDS.tenantA,
      name: "MG Road Store",
      code: "ST-002",
      currency: storeA.currency,
      addressLine: "1 MG Road",
      city: "Bengaluru",
      state: "Karnataka",
    },
  });
  await db.storeMembership.create({
    data: { tenantId: IDS.tenantA, userId: IDS.staffA, storeId: STORE_A2, role: "CASHIER" },
  });
  await db.user.update({ where: { id: IDS.ownerA }, data: { passwordHash: await hashPassword("owner-pass-1") } });
});

afterAll(async () => {
  await resetDatabase();
});

async function signIn(userId: string, userAgent: string | null = CHROME_WIN) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const { token } = await createSession({ userId, tenantId: user.tenantId, ip: "103.21.45.67", userAgent });
  const session = await resolveSession(token);
  return { token, session: session! };
}

describe("A12 store selection", () => {
  it("lists every tenant store for the owner, and only member stores for staff", async () => {
    const ownerStores = await listAvailableStores({ tenantId: IDS.tenantA, userId: IDS.ownerA, tenantRole: "OWNER" });
    expect(ownerStores.map((s) => s.id).sort()).toEqual([IDS.storeA, STORE_A2].sort());
    const staffStores = await listAvailableStores({ tenantId: IDS.tenantA, userId: IDS.staffA, tenantRole: "STAFF" });
    expect(staffStores.map((s) => s.id)).toEqual([STORE_A2]);
    expect(staffStores[0]).toMatchObject({ role: "CASHIER", staffCount: 1 });
  });

  it("refuses a store the user cannot access, including another tenant's", async () => {
    const { session } = await signIn(IDS.staffA);
    const base = { sessionId: session.id, tenantId: IDS.tenantA, userId: IDS.staffA, tenantRole: "STAFF" as const };
    expect(await selectActiveStore({ ...base, storeId: IDS.storeA })).toEqual({ status: "forbidden" });
    expect(await selectActiveStore({ ...base, storeId: IDS.storeB })).toEqual({ status: "forbidden" });
    expect(await canAccessStore({ ...base, storeId: STORE_A2 })).toBe(true);
  });

  it("every screen follows the chosen store, and falls back once access is removed", async () => {
    const { token, session } = await signIn(IDS.staffA);
    const chosen = await selectActiveStore({
      sessionId: session.id,
      tenantId: IDS.tenantA,
      userId: IDS.staffA,
      tenantRole: "STAFF",
      storeId: STORE_A2,
    });
    expect(chosen).toEqual({ status: "ok", storeId: STORE_A2 });
    const ctx = await resolvePosContext(token);
    expect(ctx.status === "ok" && ctx.context.storeId).toBe(STORE_A2);
    expect(ctx.status === "ok" && ctx.context.membershipRole).toBe("CASHIER");

    await db.storeMembership.delete({ where: { userId_storeId: { userId: IDS.staffA, storeId: STORE_A2 } } });
    const after = await resolvePosContext(token);
    expect(after.status === "ok" && after.context.storeId).not.toBe(STORE_A2);
  });

  it("records the switch in the audit log", async () => {
    const { session } = await signIn(IDS.ownerA);
    await selectActiveStore({
      sessionId: session.id,
      tenantId: IDS.tenantA,
      userId: IDS.ownerA,
      tenantRole: "OWNER",
      storeId: STORE_A2,
    });
    expect(await db.auditLog.count({ where: { userId: IDS.ownerA, action: "ContextChanged" } })).toBe(1);
  });
});

describe("A14 sessions and devices", () => {
  it("lists only the user's own live sessions, current first, with readable devices", async () => {
    const phone = await signIn(IDS.ownerA, IPHONE);
    const desk = await signIn(IDS.ownerA, CHROME_WIN);
    await signIn(IDS.ownerB);
    const list = await listActiveSessions({ userId: IDS.ownerA, tenantId: IDS.tenantA, currentSessionId: desk.session.id });
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      id: desk.session.id,
      isCurrent: true,
      device: { kind: "desktop", label: "Windows – Chrome" },
    });
    expect(list.find((s) => s.id === phone.session.id)?.device).toEqual({ kind: "mobile", label: "iPhone – Safari" });
    expect(JSON.stringify(list)).not.toContain(desk.token);
  });

  it("signs out one session, never another user's, and then that token stops working", async () => {
    const mine = await signIn(IDS.ownerA);
    const theirs = await signIn(IDS.ownerB);
    expect(await revokeOwnSession({ userId: IDS.ownerA, tenantId: IDS.tenantA, sessionId: theirs.session.id })).toEqual({
      status: "not_found",
    });
    expect(await resolveSession(theirs.token)).not.toBeNull();
    expect(await revokeOwnSession({ userId: IDS.ownerA, tenantId: IDS.tenantA, sessionId: mine.session.id })).toEqual({
      status: "ok",
    });
    expect(await resolveSession(mine.token)).toBeNull();
  });

  it("signs out every other device and keeps this one", async () => {
    const a = await signIn(IDS.ownerA);
    const b = await signIn(IDS.ownerA, IPHONE);
    const c = await signIn(IDS.ownerA, IPHONE);
    expect(await revokeOtherSessions({ userId: IDS.ownerA, tenantId: IDS.tenantA, keepSessionId: a.session.id })).toEqual({
      revoked: 2,
    });
    expect(await resolveSession(a.token)).not.toBeNull();
    expect(await resolveSession(b.token)).toBeNull();
    expect(await resolveSession(c.token)).toBeNull();
  });
});

describe("A13 security settings", () => {
  it("changes the password only with the current one, and signs out other devices", async () => {
    const here = await signIn(IDS.ownerA);
    const other = await signIn(IDS.ownerA, IPHONE);
    const base = { userId: IDS.ownerA, tenantId: IDS.tenantA, currentSessionId: here.session.id };
    expect(await changeOwnPassword({ ...base, currentPassword: "nope", newPassword: "Another-pass-9" })).toEqual({
      status: "wrong_password",
    });
    expect((await changeOwnPassword({ ...base, currentPassword: "owner-pass-1", newPassword: "short" })).status).toBe(
      "weak_password",
    );
    expect(await changeOwnPassword({ ...base, currentPassword: "owner-pass-1", newPassword: "owner-pass-1" })).toEqual({
      status: "same_password",
    });
    expect(await changeOwnPassword({ ...base, currentPassword: "owner-pass-1", newPassword: "Another-pass-9" })).toEqual({
      status: "ok",
      signedOutOthers: 1,
    });
    const user = await db.user.findUniqueOrThrow({ where: { id: IDS.ownerA } });
    expect(await verifyPassword("Another-pass-9", user.passwordHash)).toBe(true);
    expect(await resolveSession(here.token)).not.toBeNull();
    expect(await resolveSession(other.token)).toBeNull();
  });

  it("turns two-step sign-in on and off with the password, and shows it in activity", async () => {
    expect(await setOwnMfa({ userId: IDS.ownerA, tenantId: IDS.tenantA, password: "wrong", enabled: true })).toEqual({
      status: "wrong_password",
    });
    expect(await setOwnMfa({ userId: IDS.ownerA, tenantId: IDS.tenantA, password: "owner-pass-1", enabled: true })).toEqual({
      status: "ok",
      enabled: true,
    });
    expect((await db.user.findUniqueOrThrow({ where: { id: IDS.ownerA } })).mfaEnabled).toBe(true);
    await setOwnMfa({ userId: IDS.ownerA, tenantId: IDS.tenantA, password: "owner-pass-1", enabled: false });
    const owner = await db.user.findUniqueOrThrow({ where: { id: IDS.ownerA } });
    const activity = await recentSecurityActivity({ userId: IDS.ownerA, tenantId: IDS.tenantA, email: owner.email });
    expect(activity.map((e) => e.label)).toEqual(
      expect.arrayContaining(["Two-step sign-in turned on", "Two-step sign-in turned off"]),
    );
  });

  it("describes devices without trusting the string", () => {
    expect(describeUserAgent(null)).toEqual({ kind: "unknown", label: "Unknown device" });
    expect(describeUserAgent("curl/8.4.0")).toEqual({ kind: "unknown", label: "Script" });
  });
});

describe("A13 idle sign-out and audit logs", () => {
  it("ends a session idle past the user's limit, and keeps a recently used one", async () => {
    expect(await setOwnIdleTimeout({ userId: IDS.ownerA, tenantId: IDS.tenantA, minutes: 15 })).toEqual({ status: "ok" });
    expect(await setOwnIdleTimeout({ userId: IDS.ownerA, tenantId: IDS.tenantA, minutes: 7 })).toEqual({ status: "invalid" });
    const fresh = await signIn(IDS.ownerA);
    expect(await resolveSession(fresh.token)).not.toBeNull();

    const idle = await signIn(IDS.ownerA);
    await db.session.update({ where: { id: idle.session.id }, data: { lastSeenAt: new Date(Date.now() - 16 * 60_000) } });
    expect(await resolveSession(idle.token)).toBeNull();
    expect((await db.session.findUniqueOrThrow({ where: { id: idle.session.id } })).revokedAt).not.toBeNull();

    await setOwnIdleTimeout({ userId: IDS.ownerA, tenantId: IDS.tenantA, minutes: null });
    const old = await signIn(IDS.ownerA);
    await db.session.update({ where: { id: old.session.id }, data: { lastSeenAt: new Date(Date.now() - 600 * 60_000) } });
    expect(await resolveSession(old.token)).not.toBeNull();
  });

  it("shows the owner the whole business and staff only their own actions", async () => {
    const { session } = await signIn(IDS.ownerA);
    await selectActiveStore({ sessionId: session.id, tenantId: IDS.tenantA, userId: IDS.ownerA, tenantRole: "OWNER", storeId: STORE_A2 });
    const staff = await signIn(IDS.staffA);
    await selectActiveStore({ sessionId: staff.session.id, tenantId: IDS.tenantA, userId: IDS.staffA, tenantRole: "STAFF", storeId: STORE_A2 });

    const ownerView = await listAuditEntries({ tenantId: IDS.tenantA, userId: IDS.ownerA, tenantRole: "OWNER" });
    expect(ownerView.entries.filter((e) => e.action === "ContextChanged")).toHaveLength(2);
    expect(ownerView.entries[0]?.label).toBe("Context changed");

    const staffView = await listAuditEntries({ tenantId: IDS.tenantA, userId: IDS.staffA, tenantRole: "STAFF" });
    expect(staffView.entries.filter((e) => e.action === "ContextChanged")).toHaveLength(1);
    const otherTenant = await listAuditEntries({ tenantId: IDS.tenantB, userId: IDS.ownerB, tenantRole: "OWNER" });
    expect(otherTenant.entries.some((e) => e.action === "ContextChanged")).toBe(false);
  });
});
