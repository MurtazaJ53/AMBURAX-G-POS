import { describe, expect, it, vi, beforeEach } from "vitest";

// Mocked Prisma, same disclosed limitation as every other suite here: no live database is
// available in this sandbox, so the concurrency assertions prove the *code's* handling of a
// lost conditional claim (count 0), not Postgres's real row-locking behaviour.

const mockDb = {
  tenant: { findUnique: vi.fn(), updateMany: vi.fn() },
  store: { findFirst: vi.fn() },
  storeMembership: { count: vi.fn() },
  invitation: { findMany: vi.fn() },
  posDevice: { findMany: vi.fn() },
};

vi.mock("@/server/db", () => ({ db: mockDb }));
vi.mock("@/server/identity/loginGuard", () => ({
  isIpRateLimited: vi.fn(async () => false),
  recordAttempt: vi.fn(async () => {}),
}));
vi.mock("@/server/identity/audit", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/server/identity/session", () => ({ resolveSession: vi.fn() }));

const { getOnboardingReadiness } = await import("@/server/onboarding/readiness");
const { completeOnboarding } = await import("@/server/onboarding/completeOnboarding");
const { resolveSession } = await import("@/server/identity/session");
const { isIpRateLimited } = await import("@/server/identity/loginGuard");
const { writeAuditLog } = await import("@/server/identity/audit");

const OWNER = {
  userId: "user-1",
  tenantId: "tenant-1",
  user: { id: "user-1", email: "owner@example.com", tenantRole: "OWNER" as const },
};

const STAFF = {
  userId: "user-2",
  tenantId: "tenant-1",
  user: { id: "user-2", email: "cashier@example.com", tenantRole: "STAFF" as const },
};

function pendingDevice(overrides: Record<string, unknown> = {}) {
  return {
    name: "Main Counter",
    code: "POS-01",
    activatedAt: null,
    disabledAt: null,
    pairingExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
    ...overrides,
  };
}

const activeDevice = () => pendingDevice({ activatedAt: new Date(), pairingExpiresAt: null });

function setTenant(onboardingStep: string, erpnextProvisionStatus = "NOT_PROVISIONED") {
  mockDb.tenant.findUnique.mockResolvedValue({
    name: "Acme Retail",
    onboardingStep,
    erpnextProvisionStatus,
  });
}

interface Item {
  key: string;
  level: string;
  detail: string;
  blocksSale: boolean;
  action: unknown;
}

interface Readiness {
  onboardingStep: string;
  onboardingComplete: boolean;
  operationalReady: boolean;
  canComplete: boolean;
  items: Item[];
  businessName: string;
  storeName: string | null;
}

function item(r: { items: Item[] }, key: string): Item {
  const found = r.items.find((i) => i.key === key);
  if (!found) throw new Error(`no readiness item for ${key}`);
  return found;
}

async function readiness(): Promise<Readiness> {
  const result = await getOnboardingReadiness({ tenantId: "tenant-1", userId: "user-1" });
  if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
  return result.readiness as Readiness;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isIpRateLimited).mockResolvedValue(false);
  vi.mocked(resolveSession).mockResolvedValue(OWNER as never);
  setTenant("POS_CONFIGURED");
  mockDb.store.findFirst.mockResolvedValue({
    id: "store-1",
    name: "Acme Main Street",
    storeType: "RETAIL",
    erpnextProvisionStatus: "NOT_PROVISIONED",
  });
  mockDb.storeMembership.count.mockResolvedValue(1); // the owner's own membership
  mockDb.invitation.findMany.mockResolvedValue([]);
  mockDb.posDevice.findMany.mockResolvedValue([pendingDevice()]);
  mockDb.tenant.updateMany.mockResolvedValue({ count: 1 });
});

describe("POS readiness — the A10 regression that matters", () => {
  it("POS_CONFIGURED + PENDING_ACTIVATION does NOT report operational POS readiness", async () => {
    setTenant("POS_CONFIGURED");
    mockDb.posDevice.findMany.mockResolvedValue([pendingDevice()]);

    const r = await readiness();
    const pos = item(r, "pos");

    expect(pos.level).toBe("PENDING");
    expect(pos.level).not.toBe("READY");
    expect(pos.blocksSale).toBe(true);
    expect(r.operationalReady).toBe(false);
  });

  it("says 'still needs to be paired' rather than anything resembling 'POS ready'", async () => {
    const pos = item(await readiness(), "pos");
    expect(pos.detail).toContain("still needs to be paired");
    expect(pos.detail.toLowerCase()).not.toContain("pos is ready");
    expect(pos.detail.toLowerCase()).not.toContain("ready to sell");
  });

  it("derives from PosDevice state, not from onboardingStep — COMPLETE with an unpaired terminal is still PENDING", async () => {
    setTenant("COMPLETE");
    mockDb.posDevice.findMany.mockResolvedValue([pendingDevice()]);

    const r = await readiness();
    expect(r.onboardingComplete).toBe(true);
    expect(item(r, "pos").level).toBe("PENDING");
    expect(r.operationalReady).toBe(false);
  });

  it("reports an expired pairing code as ATTENTION, not PENDING", async () => {
    mockDb.posDevice.findMany.mockResolvedValue([
      pendingDevice({ pairingExpiresAt: new Date(Date.now() - 1000) }),
    ]);
    const pos = item(await readiness(), "pos");
    expect(pos.level).toBe("ATTENTION");
    expect(pos.detail).toContain("expired");
  });

  it("reports a disabled terminal as ATTENTION and never as ready", async () => {
    mockDb.posDevice.findMany.mockResolvedValue([pendingDevice({ disabledAt: new Date() })]);
    const pos = item(await readiness(), "pos");
    expect(pos.level).toBe("ATTENTION");
    expect(pos.detail).toContain("disabled");
  });

  it("reports no terminal at all as NOT_CONFIGURED with a real action link", async () => {
    mockDb.posDevice.findMany.mockResolvedValue([]);
    const pos = item(await readiness(), "pos");
    expect(pos.level).toBe("NOT_CONFIGURED");
    expect(pos.action).toEqual({ label: "Set up a terminal", href: "/onboarding/pos" });
  });

  it("reports READY only once a device has genuinely activated", async () => {
    mockDb.posDevice.findMany.mockResolvedValue([activeDevice()]);
    const pos = item(await readiness(), "pos");
    expect(pos.level).toBe("READY");
    expect(pos.blocksSale).toBe(false);
  });

  it("an active terminal outranks a sibling that is still pending", async () => {
    mockDb.posDevice.findMany.mockResolvedValue([pendingDevice(), activeDevice()]);
    expect(item(await readiness(), "pos").level).toBe("READY");
  });
});

describe("operational readiness vs onboarding completion", () => {
  it("keeps the two booleans independent — COMPLETE does not imply ready", async () => {
    setTenant("COMPLETE");
    const r = await readiness();
    expect(r.onboardingComplete).toBe(true);
    expect(r.operationalReady).toBe(false);
  });

  it("stays false while ERPNext stock is unprovisioned, even with an active terminal", async () => {
    mockDb.posDevice.findMany.mockResolvedValue([activeDevice()]);
    const r = await readiness();
    expect(item(r, "inventory").level).toBe("UNAVAILABLE");
    expect(r.operationalReady).toBe(false);
  });

  it("never reports payments as configured — no payment system exists", async () => {
    const payments = item(await readiness(), "payments");
    expect(payments.level).toBe("UNAVAILABLE");
    expect(payments.blocksSale).toBe(true);
    // UNAVAILABLE items offer no action: telling a merchant to configure something the
    // platform cannot do yet would be a lie.
    expect(payments.action).toBeNull();
  });

  it("offers no action link on any UNAVAILABLE item", async () => {
    const r = await readiness();
    for (const i of r.items.filter((x) => x.level === "UNAVAILABLE")) {
      expect(i.action).toBeNull();
    }
  });

  it("optional items never block a sale", async () => {
    const r = await readiness();
    for (const key of ["business", "owner", "team"]) {
      expect(item(r, key).blocksSale).toBe(false);
    }
  });

  it("leaks no internal ids in the payload", async () => {
    const serialized = JSON.stringify(await readiness());
    expect(serialized).not.toContain("store-1");
    expect(serialized).not.toContain("tenant-1");
    expect(serialized).not.toContain("user-1");
  });
});

describe("team readiness — A8 skip is not an error", () => {
  it("zero invitations and no staff reports NOT_CONFIGURED, not a failure, and never blocks", async () => {
    mockDb.storeMembership.count.mockResolvedValue(1);
    mockDb.invitation.findMany.mockResolvedValue([]);

    const team = item(await readiness(), "team");
    expect(team.level).toBe("NOT_CONFIGURED");
    expect(team.blocksSale).toBe(false);
    expect(team.detail).toContain("just you for now");
  });

  it("pending invitations report PENDING", async () => {
    mockDb.invitation.findMany.mockResolvedValue([
      { acceptedAt: null, revokedAt: null, expiresAt: new Date(Date.now() + 86_400_000) },
    ]);
    const team = item(await readiness(), "team");
    expect(team.level).toBe("PENDING");
    expect(team.detail).toContain("1 invitation sent");
  });

  it("an accepted invitation (A11) shows the member as joined", async () => {
    mockDb.storeMembership.count.mockResolvedValue(2); // owner + one accepted staff member
    mockDb.invitation.findMany.mockResolvedValue([
      { acceptedAt: new Date(), revokedAt: null, expiresAt: new Date(Date.now() + 86_400_000) },
    ]);
    const team = item(await readiness(), "team");
    expect(team.level).toBe("READY");
    expect(team.detail).toContain("1 team member has joined");
  });

  it("expired and revoked invitations are not counted as pending", async () => {
    mockDb.invitation.findMany.mockResolvedValue([
      { acceptedAt: null, revokedAt: null, expiresAt: new Date(Date.now() - 1000) },
      { acceptedAt: null, revokedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) },
    ]);
    expect(item(await readiness(), "team").level).toBe("NOT_CONFIGURED");
  });
});

describe("inconsistent state", () => {
  it("a tenant past the store step with no store is reported as inconsistent, not as a checklist", async () => {
    setTenant("POS_CONFIGURED");
    mockDb.store.findFirst.mockResolvedValue(null);

    const result = await getOnboardingReadiness({ tenantId: "tenant-1", userId: "user-1" });
    expect(result.status).toBe("inconsistent");
    if (result.status === "inconsistent") expect(result.reason).toBe("missing_store");
  });

  it("an early-step tenant with no store is normal, not inconsistent", async () => {
    setTenant("OWNER_CREATED");
    mockDb.store.findFirst.mockResolvedValue(null);

    const result = await getOnboardingReadiness({ tenantId: "tenant-1", userId: "user-1" });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(item(result.readiness as Readiness, "store").level).toBe("NOT_CONFIGURED");
  });

  it("a missing tenant is unauthorized, not a blank checklist", async () => {
    mockDb.tenant.findUnique.mockResolvedValue(null);
    const result = await getOnboardingReadiness({ tenantId: "tenant-1", userId: "user-1" });
    expect(result.status).toBe("unauthorized");
  });

  it("propagates a datastore failure rather than reporting false readiness", async () => {
    mockDb.tenant.findUnique.mockRejectedValue(new Error("connection refused"));
    await expect(getOnboardingReadiness({ tenantId: "tenant-1", userId: "user-1" })).rejects.toThrow(
      "connection refused",
    );
  });
});

describe("completeOnboarding", () => {
  it("advances POS_CONFIGURED → COMPLETE and stamps the completion time", async () => {
    const result = await completeOnboarding({ sessionToken: "t", ip: "10.0.0.1", correlationId: "c" });

    expect(result.status).toBe("ok");
    const call = mockDb.tenant.updateMany.mock.calls[0]![0] as {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    };
    expect(call.where).toEqual({ id: "tenant-1", onboardingStep: "POS_CONFIGURED" });
    expect(call.data.onboardingStep).toBe("COMPLETE");
    expect(call.data.onboardingCompletedAt).toBeInstanceOf(Date);
  });

  it("A8 skipped → A9 completed → A10 succeeds (the skip path reaches COMPLETE)", async () => {
    // A tenant that pressed Skip at A8 still arrives at POS_CONFIGURED, because A9
    // normalized both predecessors. A10 needs no A8-awareness of its own.
    setTenant("POS_CONFIGURED");
    mockDb.invitation.findMany.mockResolvedValue([]); // never invited anyone
    mockDb.storeMembership.count.mockResolvedValue(1);

    const result = await completeOnboarding({ sessionToken: "t", ip: "10.0.0.1", correlationId: "c" });
    expect(result.status).toBe("ok");
  });

  it("is not gated on operational readiness — an unpaired terminal must not block finishing", async () => {
    mockDb.posDevice.findMany.mockResolvedValue([pendingDevice()]);
    const result = await completeOnboarding({ sessionToken: "t", ip: "10.0.0.1", correlationId: "c" });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.readiness.operationalReady).toBe(false);
  });

  it("records whether the system was operationally ready at completion time", async () => {
    await completeOnboarding({ sessionToken: "t", ip: "10.0.0.1", correlationId: "c" });
    const entry = vi.mocked(writeAuditLog).mock.calls.find((c) => c[0].action === "OnboardingCompleted");
    expect(entry).toBeDefined();
    expect(entry![0].metadata).toMatchObject({ to: "COMPLETE", operationalReady: false });
  });

  it("a second call returns already_complete and writes no duplicate audit row", async () => {
    mockDb.tenant.updateMany.mockResolvedValue({ count: 0 });
    setTenant("COMPLETE");

    const result = await completeOnboarding({ sessionToken: "t", ip: "10.0.0.1", correlationId: "c" });

    expect(result.status).toBe("already_complete");
    const completions = vi
      .mocked(writeAuditLog)
      .mock.calls.filter((c) => c[0].action === "OnboardingCompleted");
    expect(completions).toHaveLength(0);
  });

  it("two concurrent completions: exactly one transition, one audit row", async () => {
    mockDb.tenant.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    mockDb.tenant.findUnique.mockResolvedValue({
      name: "Acme Retail",
      onboardingStep: "COMPLETE",
      erpnextProvisionStatus: "NOT_PROVISIONED",
    });

    const [first, second] = await Promise.all([
      completeOnboarding({ sessionToken: "t", ip: "10.0.0.1", correlationId: "c1" }),
      completeOnboarding({ sessionToken: "t", ip: "10.0.0.1", correlationId: "c2" }),
    ]);

    expect([first.status, second.status].sort()).toEqual(["already_complete", "ok"]);
    const completions = vi
      .mocked(writeAuditLog)
      .mock.calls.filter((c) => c[0].action === "OnboardingCompleted");
    expect(completions).toHaveLength(1);
  });

  it("never rolls COMPLETE backwards — the claim is conditional on POS_CONFIGURED", async () => {
    mockDb.tenant.updateMany.mockResolvedValue({ count: 0 });
    setTenant("COMPLETE");

    await completeOnboarding({ sessionToken: "t", ip: "10.0.0.1", correlationId: "c" });
    for (const call of mockDb.tenant.updateMany.mock.calls) {
      expect((call[0] as { where: Record<string, unknown> }).where.onboardingStep).toBe("POS_CONFIGURED");
    }
  });

  it("refuses a tenant that has not reached the POS step", async () => {
    mockDb.tenant.updateMany.mockResolvedValue({ count: 0 });
    setTenant("STORE_CREATED");

    const result = await completeOnboarding({ sessionToken: "t", ip: "10.0.0.1", correlationId: "c" });
    expect(result.status).toBe("wrong_step");
    if (result.status === "wrong_step") expect(result.onboardingStep).toBe("STORE_CREATED");
  });

  it("refuses a STAFF user and writes nothing", async () => {
    vi.mocked(resolveSession).mockResolvedValue(STAFF as never);
    const result = await completeOnboarding({ sessionToken: "t", ip: "10.0.0.1", correlationId: "c" });

    expect(result.status).toBe("forbidden");
    expect(mockDb.tenant.updateMany).not.toHaveBeenCalled();
  });

  it("refuses an unauthenticated caller before touching anything", async () => {
    vi.mocked(resolveSession).mockResolvedValue(null);
    const result = await completeOnboarding({ sessionToken: "t", ip: "10.0.0.1", correlationId: "c" });

    expect(result.status).toBe("unauthorized");
    expect(mockDb.tenant.updateMany).not.toHaveBeenCalled();
  });

  it("rate-limits before writing", async () => {
    vi.mocked(isIpRateLimited).mockResolvedValue(true);
    const result = await completeOnboarding({ sessionToken: "t", ip: "10.0.0.1", correlationId: "c" });

    expect(result.status).toBe("rate_limited");
    expect(mockDb.tenant.updateMany).not.toHaveBeenCalled();
  });

  it("resolves the tenant from the session, never from caller input", async () => {
    await completeOnboarding({ sessionToken: "t", ip: "10.0.0.1", correlationId: "c" });
    const call = mockDb.tenant.updateMany.mock.calls[0]![0] as { where: { id: string } };
    expect(call.where.id).toBe(OWNER.tenantId);
  });
});
