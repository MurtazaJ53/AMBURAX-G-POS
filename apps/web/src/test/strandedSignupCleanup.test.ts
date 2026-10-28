import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  tenant: { findMany: vi.fn(), findFirst: vi.fn(), delete: vi.fn() },
  onboardingSession: { deleteMany: vi.fn() },
  uom: { deleteMany: vi.fn() },
  $transaction: vi.fn(),
};
vi.mock("@/server/db", () => ({ db }));

const { cleanupStrandedSignups, strandedSignupWhere, parseArgs } = await import("@/server/tenant/strandedSignupCleanup");

const now = new Date("2026-10-28T00:00:00Z");
const row = { id: "t-old", name: "Old Shop", createdAt: new Date("2026-10-01T00:00:00Z") };

beforeEach(() => {
  vi.clearAllMocks();
  db.tenant.findMany.mockResolvedValue([row]);
  db.tenant.findFirst.mockResolvedValue({ id: "t-old" });
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
});

describe("stranded sign-up cleanup", () => {
  it("matches only owner-less BUSINESS_CREATED tenants older than 7 days with no ERPNext link, sales, stores or events", () => {
    expect(strandedSignupWhere(now)).toEqual({
      onboardingStep: "BUSINESS_CREATED",
      createdAt: { lt: new Date("2026-10-21T00:00:00Z") },
      users: { none: {} },
      erpnextProvisionStatus: "NOT_PROVISIONED",
      erpnextCompanyId: null,
      sales: { none: {} },
      stores: { none: {} },
      outboxEvents: { none: {} },
    });
  });

  it("is a dry run unless --delete is passed", async () => {
    expect(parseArgs([])).toEqual({ delete: false });
    expect(parseArgs(["--dry-run"])).toEqual({ delete: false });
    expect(parseArgs(["--delete"])).toEqual({ delete: true });
    const log = vi.fn();
    const summary = await cleanupStrandedSignups({ delete: false, now, log });
    expect(summary.matched).toEqual([{ id: "t-old", name: "Old Shop", createdAt: "2026-10-01T00:00:00.000Z" }]);
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.tenant.delete).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ action: "would delete", id: "t-old" }));
  });

  it("re-checks each tenant inside the transaction and skips one that moved on", async () => {
    db.tenant.findFirst.mockResolvedValue(null);
    const summary = await cleanupStrandedSignups({ delete: true, now, log: () => {} });
    expect(db.tenant.findFirst.mock.calls[0]![0].where).toMatchObject({ id: "t-old", onboardingStep: "BUSINESS_CREATED" });
    expect(db.tenant.delete).not.toHaveBeenCalled();
    expect(summary.skipped).toEqual([{ id: "t-old", reason: "no longer stranded" }]);
  });

  it("deletes the registration leftovers and then the tenant", async () => {
    const summary = await cleanupStrandedSignups({ delete: true, now, log: () => {} });
    expect(db.onboardingSession.deleteMany).toHaveBeenCalledWith({ where: { tenantId: "t-old" } });
    expect(db.uom.deleteMany).toHaveBeenCalledWith({ where: { tenantId: "t-old" } });
    expect(db.tenant.delete).toHaveBeenCalledWith({ where: { id: "t-old" } });
    expect(summary.deleted).toEqual(["t-old"]);
  });
});
