import { describe, expect, it, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// createFirstPosDevice touches Prisma (the tenant step claim, the device insert), session
// resolution, store/membership lookups, the rate limiter and audit logging — all mocked.
// The concurrency tests drive the *code's* lost-claim path by making the conditional
// `updateMany` return count 0, which is what Postgres would do to the loser. They do NOT
// exercise real Postgres row locking or a real unique index under parallel load — no live
// database is available in this sandbox (same disclosed limitation as A4-A8/A11).

function uniqueViolation(field: string) {
  return new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on the fields: (\`${field}\`)`, {
    code: "P2002",
    clientVersion: "5.22.0",
    meta: { target: [field] },
  });
}

const mockTx = {
  tenant: { updateMany: vi.fn() },
  posDevice: { create: vi.fn() },
  // The outbox event is enqueued on this same transaction client — that is the whole
  // point of the pattern, so the fixture has to model it rather than mock it away.
  outboxEvent: { create: vi.fn() },
};

const mockDb = {
  store: { findFirst: vi.fn() },
  storeMembership: { findUnique: vi.fn() },
  tenant: { updateMany: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
};

vi.mock("@/server/db", () => ({ db: mockDb }));
vi.mock("@/server/identity/loginGuard", () => ({
  isIpRateLimited: vi.fn(async () => false),
  recordAttempt: vi.fn(async () => {}),
}));
vi.mock("@/server/identity/audit", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/server/identity/session", () => ({ resolveSession: vi.fn() }));

const { createFirstPosDevice, completePosStep } = await import("@/server/pos/posDeviceSetup");
const { resolveSession } = await import("@/server/identity/session");
const { isIpRateLimited } = await import("@/server/identity/loginGuard");
const { writeAuditLog } = await import("@/server/identity/audit");

const OWNER_SESSION = {
  userId: "user-1",
  tenantId: "tenant-1",
  user: { id: "user-1", email: "owner@example.com", tenantRole: "OWNER" as const },
};

const STAFF_SESSION = {
  userId: "user-2",
  tenantId: "tenant-1",
  user: { id: "user-2", email: "staff@example.com", tenantRole: "STAFF" as const },
};

function input(overrides: Record<string, unknown> = {}) {
  return {
    sessionToken: "session-token",
    storeId: "store-1",
    name: "Main Counter",
    code: "pos-01",
    showProductImages: true,
    scanSoundEnabled: true,
    cashDrawerEnabled: false,
    ip: "10.0.0.1",
    correlationId: "corr-1",
    ...overrides,
  };
}

function createdDevice(overrides: Record<string, unknown> = {}) {
  return { id: "device-1", name: "Main Counter", code: "POS-01", ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isIpRateLimited).mockResolvedValue(false);
  vi.mocked(resolveSession).mockResolvedValue(OWNER_SESSION as never);
  mockDb.store.findFirst.mockResolvedValue({ id: "store-1" });
  mockDb.storeMembership.findUnique.mockResolvedValue({ role: "OWNER" });
  mockDb.tenant.updateMany.mockResolvedValue({ count: 1 });
  mockTx.tenant.updateMany.mockResolvedValue({ count: 1 });
  mockTx.posDevice.create.mockResolvedValue(createdDevice());
  mockTx.outboxEvent.create.mockResolvedValue({ id: "evt-1", idempotencyKey: "k" });
});

describe("createFirstPosDevice — happy path", () => {
  it("creates the terminal, advances onboarding, and returns a one-time pairing code", async () => {
    const result = await createFirstPosDevice(input());

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(result.device.code).toBe("POS-01");
    expect(result.device.status).toBe("PENDING_ACTIVATION");
    expect(result.pairingCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4})+$/);
    expect(result.pairingExpiresAt).toBeTruthy();
  });

  it("uppercases the device code so POS-01 and pos-01 cannot coexist", async () => {
    await createFirstPosDevice(input({ code: "pos-01" }));
    expect(mockTx.posDevice.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ code: "POS-01" }) }),
    );
  });

  it("stores only a hash of the pairing code, never the code itself", async () => {
    const result = await createFirstPosDevice(input());
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    const written = mockTx.posDevice.create.mock.calls[0]![0].data as Record<string, unknown>;
    const raw = result.pairingCode.replace(/-/g, "");
    expect(written.pairingCodeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(written.pairingCodeHash).not.toContain(raw);
    expect(JSON.stringify(written)).not.toContain(raw);
  });

  it("never writes the raw pairing code into the audit log", async () => {
    const result = await createFirstPosDevice(input());
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    const raw = result.pairingCode.replace(/-/g, "");
    for (const call of vi.mocked(writeAuditLog).mock.calls) {
      expect(JSON.stringify(call[0])).not.toContain(raw);
    }
  });

  it("creates the device with no ERPNext field of any kind — a till is not an ERP document", async () => {
    await createFirstPosDevice(input());
    const written = mockTx.posDevice.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(Object.keys(written).some((k) => k.toLowerCase().includes("erpnext"))).toBe(false);
  });

  it("persists the configuration the merchant chose", async () => {
    await createFirstPosDevice(
      input({ receiptHeader: " Acme Retail ", receiptFooter: "", cashDrawerEnabled: true, scanSoundEnabled: false }),
    );
    const written = mockTx.posDevice.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(written.receiptHeader).toBe("Acme Retail");
    expect(written.receiptFooter).toBeNull();
    expect(written.cashDrawerEnabled).toBe(true);
    expect(written.scanSoundEnabled).toBe(false);
  });

  it("enqueues a PosDeviceCreated event on the SAME transaction client", async () => {
    await createFirstPosDevice(input());

    expect(mockTx.outboxEvent.create).toHaveBeenCalledTimes(1);
    const data = mockTx.outboxEvent.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.eventType).toBe("PosDeviceCreated");
    expect(data.tenantId).toBe("tenant-1");
    expect(data.entityId).toBe("device-1");
  });

  it("never puts the pairing code in the event payload", async () => {
    const result = await createFirstPosDevice(input());
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    const data = mockTx.outboxEvent.create.mock.calls[0]![0].data as Record<string, unknown>;
    const raw = result.pairingCode.replace(/-/g, "");
    expect(JSON.stringify(data.payload)).not.toContain(raw);
  });

  it("does not set activatedAt — a created row is not a paired terminal", async () => {
    await createFirstPosDevice(input());
    const written = mockTx.posDevice.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(written.activatedAt).toBeUndefined();
    expect(written.lastSeenAt).toBeUndefined();
  });
});

describe("createFirstPosDevice — onboarding step (A8 skip compatibility)", () => {
  it("accepts both STORE_CREATED and TEAM_INVITED as predecessors", async () => {
    await createFirstPosDevice(input());
    const where = mockTx.tenant.updateMany.mock.calls[0]![0].where as Record<string, unknown>;
    expect(where.onboardingStep).toEqual({ in: ["STORE_CREATED", "TEAM_INVITED"] });
  });

  it("advances to POS_CONFIGURED exactly once", async () => {
    await createFirstPosDevice(input());
    expect(mockTx.tenant.updateMany).toHaveBeenCalledTimes(1);
    const data = mockTx.tenant.updateMany.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).toEqual({ onboardingStep: "POS_CONFIGURED" });
  });

  it("refuses when the tenant is not at a POS-eligible step", async () => {
    mockTx.tenant.updateMany.mockResolvedValue({ count: 0 });
    const result = await createFirstPosDevice(input());
    expect(result.status).toBe("wrong_step");
    expect(mockTx.posDevice.create).not.toHaveBeenCalled();
  });
});

describe("createFirstPosDevice — authorization", () => {
  it("rejects an unauthenticated caller before touching the store", async () => {
    vi.mocked(resolveSession).mockResolvedValue(null);
    const result = await createFirstPosDevice(input());
    expect(result.status).toBe("unauthorized");
    expect(mockDb.store.findFirst).not.toHaveBeenCalled();
  });

  it("scopes the store lookup to the caller's tenant, so a cross-tenant storeId is invisible", async () => {
    mockDb.store.findFirst.mockResolvedValue(null);
    const result = await createFirstPosDevice(input({ storeId: "store-of-another-tenant" }));

    expect(result.status).toBe("store_not_found");
    expect(mockDb.store.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "store-of-another-tenant", tenantId: "tenant-1" } }),
    );
    expect(mockTx.posDevice.create).not.toHaveBeenCalled();
  });

  it("blocks a staff member with access to another store in the same tenant", async () => {
    vi.mocked(resolveSession).mockResolvedValue(STAFF_SESSION as never);
    // No membership on the target store — the user's access to some other store is
    // irrelevant, and this is exactly the cross-store registration attempt.
    mockDb.storeMembership.findUnique.mockResolvedValue(null);

    const result = await createFirstPosDevice(input());
    expect(result.status).toBe("forbidden");
    expect(mockTx.posDevice.create).not.toHaveBeenCalled();
  });

  it("blocks a cashier — a store membership alone is not a POS-configuration capability", async () => {
    vi.mocked(resolveSession).mockResolvedValue(STAFF_SESSION as never);
    mockDb.storeMembership.findUnique.mockResolvedValue({ role: "CASHIER" });

    const result = await createFirstPosDevice(input());
    expect(result.status).toBe("forbidden");
  });

  it("allows a store manager — POS setup is not hard-wired to tenant ownership", async () => {
    vi.mocked(resolveSession).mockResolvedValue(STAFF_SESSION as never);
    mockDb.storeMembership.findUnique.mockResolvedValue({ role: "STORE_MANAGER" });

    const result = await createFirstPosDevice(input());
    expect(result.status).toBe("ok");
  });

  it("allows the tenant owner even without a membership row on that store", async () => {
    mockDb.storeMembership.findUnique.mockResolvedValue(null);
    const result = await createFirstPosDevice(input());
    expect(result.status).toBe("ok");
  });

  it("rate-limits before doing any work", async () => {
    vi.mocked(isIpRateLimited).mockResolvedValue(true);
    const result = await createFirstPosDevice(input());
    expect(result.status).toBe("rate_limited");
    expect(mockDb.store.findFirst).not.toHaveBeenCalled();
  });
});

describe("createFirstPosDevice — concurrency (the A9 invariant)", () => {
  it("two concurrent first-POS submits with DIFFERENT codes: the loser creates no device", async () => {
    // Postgres arbitrates: the winner's conditional updateMany matches one row and holds
    // the tenant row lock; the loser's matches zero. A unique index on (storeId, code)
    // would NOT have caught this case, because the two codes differ.
    mockTx.tenant.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    const [first, second] = await Promise.all([
      createFirstPosDevice(input({ code: "POS-01" })),
      createFirstPosDevice(input({ code: "POS-02" })),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual(["ok", "wrong_step"]);
    expect(mockTx.posDevice.create).toHaveBeenCalledTimes(1);
  });

  it("two concurrent submits with the SAME code: the unique index stops the second", async () => {
    mockTx.posDevice.create
      .mockResolvedValueOnce(createdDevice())
      .mockRejectedValueOnce(uniqueViolation("code"));

    const first = await createFirstPosDevice(input({ code: "POS-01" }));
    const second = await createFirstPosDevice(input({ code: "POS-01" }));

    expect(first.status).toBe("ok");
    expect(second.status).toBe("device_conflict");
  });

  it("the loser writes no audit entry and issues no pairing code", async () => {
    mockTx.tenant.updateMany.mockResolvedValue({ count: 0 });
    const result = await createFirstPosDevice(input());

    expect(result.status).toBe("wrong_step");
    expect(mockTx.posDevice.create).not.toHaveBeenCalled();
    const actions = vi.mocked(writeAuditLog).mock.calls.map((c) => c[0].action);
    expect(actions).not.toContain("PosDeviceCreated");
    expect(actions).not.toContain("PosDevicePairingCodeIssued");
    expect(actions).not.toContain("OnboardingStepAdvanced");
  });

  it("the loser enqueues no outbox event either", async () => {
    // The event is written with the transaction client, so a rolled-back claim leaves no
    // event behind. Proven for real against PostgreSQL in
    // src/test-integration/outbox.test.ts; this asserts the code path reaches it.
    mockTx.tenant.updateMany.mockResolvedValue({ count: 0 });

    const result = await createFirstPosDevice(input());

    expect(result.status).toBe("wrong_step");
    expect(mockTx.outboxEvent.create).not.toHaveBeenCalled();
  });

  it("claims the onboarding step BEFORE creating the device", async () => {
    const order: string[] = [];
    mockTx.tenant.updateMany.mockImplementation(async () => {
      order.push("claim");
      return { count: 1 };
    });
    mockTx.posDevice.create.mockImplementation(async () => {
      order.push("create");
      return createdDevice();
    });

    await createFirstPosDevice(input());
    expect(order).toEqual(["claim", "create"]);
  });

  it("a retry after a lost response does not produce a second device", async () => {
    // First call won and advanced the tenant; the client never saw the response and retries.
    mockTx.tenant.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    await createFirstPosDevice(input());
    const retry = await createFirstPosDevice(input());

    expect(retry.status).toBe("wrong_step");
    expect(mockTx.posDevice.create).toHaveBeenCalledTimes(1);
  });
});

describe("completePosStep — the Skip path", () => {
  it("advances the step from either predecessor without creating a device", async () => {
    const result = await completePosStep({ sessionToken: "t", ip: "10.0.0.1", correlationId: "c" });

    expect(result.status).toBe("ok");
    expect(mockTx.posDevice.create).not.toHaveBeenCalled();
    const where = mockDb.tenant.updateMany.mock.calls[0]![0].where as Record<string, unknown>;
    expect(where.onboardingStep).toEqual({ in: ["STORE_CREATED", "TEAM_INVITED"] });
  });

  it("is idempotent under a double-click — the second call advances nothing", async () => {
    mockDb.tenant.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    const first = await completePosStep({ sessionToken: "t", ip: "10.0.0.1", correlationId: "c" });
    const second = await completePosStep({ sessionToken: "t", ip: "10.0.0.1", correlationId: "c" });

    expect(first.status).toBe("ok");
    expect(second.status).toBe("already_completed");
  });

  it("is owner-only — skipping is a tenant onboarding decision, not a store operation", async () => {
    vi.mocked(resolveSession).mockResolvedValue(STAFF_SESSION as never);
    const result = await completePosStep({ sessionToken: "t", ip: "10.0.0.1", correlationId: "c" });

    expect(result.status).toBe("forbidden");
    expect(mockDb.tenant.updateMany).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller", async () => {
    vi.mocked(resolveSession).mockResolvedValue(null);
    const result = await completePosStep({ sessionToken: "t", ip: "10.0.0.1", correlationId: "c" });
    expect(result.status).toBe("unauthorized");
  });
});

describe("createFirstPosDevice — datastore failure", () => {
  it("propagates an unexpected error rather than reporting a device that does not exist", async () => {
    mockDb.$transaction.mockRejectedValueOnce(new Error("connection refused"));
    await expect(createFirstPosDevice(input())).rejects.toThrow("connection refused");
  });
});
