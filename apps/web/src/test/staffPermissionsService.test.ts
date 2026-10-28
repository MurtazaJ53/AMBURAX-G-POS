import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  user: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  invitation: { findMany: vi.fn() },
  store: { findMany: vi.fn(), findFirst: vi.fn() },
  auditLog: { findMany: vi.fn(), findFirst: vi.fn() },
  storeMembership: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  session: { updateMany: vi.fn() },
  $transaction: vi.fn(),
};
vi.mock("@/server/db", () => ({ db }));
const writeAuditLog = vi.fn();
vi.mock("@/server/identity/audit", () => ({ writeAuditLog }));

const svc = await import("@/server/identity/staffPermissionsService");

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findFirst.mockResolvedValue({ tenantRole: "STAFF" });
  db.store.findFirst.mockResolvedValue({ id: "s1" });
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
});

describe("listTenantStaff", () => {
  it("maps staff, keeps each user's latest module list, and summarises invitations", async () => {
    const created = new Date("2026-10-01T00:00:00Z");
    db.user.findMany.mockResolvedValue([
      {
        id: "u1", name: "A", email: "a@x.test", tenantRole: "STAFF", status: "ACTIVE", createdAt: created,
        lastLoginAt: null, idleTimeoutMinutes: 15, approvalPinHash: "h",
        memberships: [{ id: "m1", role: "CASHIER", storeId: "s1", store: { id: "s1", name: "Main", code: "MAIN" } }],
      },
      {
        id: "u2", name: "B", email: "b@x.test", tenantRole: "OWNER", status: "ACTIVE", createdAt: created,
        lastLoginAt: null, idleTimeoutMinutes: null, approvalPinHash: null, memberships: [],
      },
    ]);
    db.invitation.findMany.mockResolvedValue([
      { id: "i1", email: "c@x.test", role: "CASHIER", expiresAt: created, createdAt: created, store: { name: "Main" } },
    ]);
    db.store.findMany.mockResolvedValue([{ id: "s1", name: "Main", code: "MAIN" }]);
    // Newest first: the first entry for a user wins.
    db.auditLog.findMany.mockResolvedValue([
      { metadata: { targetUserId: "u1", allowedModules: ["pos"] } },
      { metadata: { targetUserId: "u1", allowedModules: ["pos", "reports"] } },
      { metadata: null },
    ]);

    const result = await svc.listTenantStaff("t1");
    expect(db.user.findMany.mock.calls[0]![0].where).toEqual({ tenantId: "t1" });
    expect(result.staff[0]).toMatchObject({
      id: "u1",
      hasApprovalPin: true,
      customModuleAccess: ["pos"],
      stores: [{ membershipId: "m1", storeId: "s1", storeName: "Main", storeCode: "MAIN", role: "CASHIER" }],
    });
    expect(result.staff[1]).toMatchObject({ id: "u2", hasApprovalPin: false, customModuleAccess: null, stores: [] });
    expect(result.pendingInvitations).toEqual([
      { id: "i1", email: "c@x.test", role: "CASHIER", storeName: "Main", expiresAt: created, createdAt: created },
    ]);
  });
});

describe("updateStaffModulePermissions", () => {
  const p = { tenantId: "t1", actorUserId: "owner", targetUserId: "u1", allowedModules: ["pos"] };

  it("refuses the owner and users of other tenants", async () => {
    db.user.findFirst.mockResolvedValueOnce({ tenantRole: "OWNER" }).mockResolvedValueOnce(null);
    expect(await svc.updateStaffModulePermissions(p)).toEqual({ status: "forbidden" });
    expect(await svc.updateStaffModulePermissions(p)).toEqual({ status: "forbidden" });
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("records the module list for staff", async () => {
    expect(await svc.updateStaffModulePermissions(p)).toEqual({ status: "ok" });
    expect(writeAuditLog.mock.calls[0]![0]).toMatchObject({
      tenantId: "t1",
      action: "staff_module_permissions",
      metadata: { targetUserId: "u1", allowedModules: ["pos"] },
    });
  });
});

describe("getUserAllowedModules", () => {
  it("returns this user's latest list, or null", async () => {
    db.auditLog.findMany.mockResolvedValue([
      { metadata: { targetUserId: "u2", allowedModules: ["reports"] } },
      { metadata: { targetUserId: "u1", allowedModules: ["pos"] } },
    ]);
    expect(await svc.getUserAllowedModules("t1", "u1")).toEqual(["pos"]);
    expect(await svc.getUserAllowedModules("t1", "u9")).toBeNull();
    expect(db.auditLog.findFirst).not.toHaveBeenCalled();
  });
});

describe("updateStaffRole", () => {
  const base = { tenantId: "t1", actorUserId: "owner", targetUserId: "u1", storeId: "s1", newRole: "CASHIER" };

  it("rejects a role that cannot be granted", async () => {
    expect(await svc.updateStaffRole({ ...base, newRole: "OWNER" })).toEqual({ status: "invalid_role" });
  });

  it("refuses to change the owner", async () => {
    db.user.findFirst.mockResolvedValue({ tenantRole: "OWNER" });
    expect(await svc.updateStaffRole(base)).toEqual({ status: "forbidden" });
  });

  it("refuses a store that belongs to another tenant", async () => {
    db.store.findFirst.mockResolvedValue(null);
    db.storeMembership.findUnique.mockResolvedValue(null);
    expect(await svc.updateStaffRole({ ...base, storeId: "other-tenant-store" })).toEqual({ status: "not_found" });
    expect(db.storeMembership.create).not.toHaveBeenCalled();
    expect(db.storeMembership.update).not.toHaveBeenCalled();
  });

  it("updates an existing membership", async () => {
    db.storeMembership.findUnique.mockResolvedValue({ id: "m1" });
    expect(await svc.updateStaffRole(base)).toEqual({ status: "ok" });
    expect(db.storeMembership.update).toHaveBeenCalledWith({ where: { id: "m1" }, data: { role: "CASHIER" } });
  });

  it("creates a membership in this tenant when there is none", async () => {
    db.storeMembership.findUnique.mockResolvedValue(null);
    expect(await svc.updateStaffRole(base)).toEqual({ status: "ok" });
    expect(db.storeMembership.create).toHaveBeenCalledWith({
      data: { tenantId: "t1", userId: "u1", storeId: "s1", role: "CASHIER" },
    });
    expect(writeAuditLog.mock.calls[0]![0]).toMatchObject({ action: "staff_role_updated" });
  });
});

describe("toggleStaffStatus", () => {
  it("revokes every live session of a disabled user in the same transaction", async () => {
    await svc.toggleStaffStatus({ tenantId: "t1", actorUserId: "o", targetUserId: "u1", active: false });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.session.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", tenantId: "t1", revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("does not touch sessions when re-activating", async () => {
    await svc.toggleStaffStatus({ tenantId: "t1", actorUserId: "o", targetUserId: "u1", active: true });
    expect(db.session.updateMany).not.toHaveBeenCalled();
  });

  it("disables and re-activates staff, never the owner", async () => {
    expect(await svc.toggleStaffStatus({ tenantId: "t1", actorUserId: "o", targetUserId: "u1", active: false })).toEqual({
      status: "ok",
    });
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { status: "DISABLED" } });
    expect(writeAuditLog.mock.calls[0]![0]).toMatchObject({ action: "staff_disabled" });
    db.user.findFirst.mockResolvedValue({ tenantRole: "OWNER" });
    expect(await svc.toggleStaffStatus({ tenantId: "t1", actorUserId: "o", targetUserId: "u2", active: false })).toEqual({
      status: "forbidden",
    });
  });
});
