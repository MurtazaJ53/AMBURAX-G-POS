import { describe, expect, it, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// createFirstStore touches Prisma (including the atomic onboardingStep claim and a
// defensive P2002 catch on store code), session resolution, the login-attempt guard, and
// audit logging — all mocked. This proves the *code's* handling of a lost concurrent
// first-store race, not Postgres's actual row-lock behavior under real load (no live
// database in this sandbox — same disclosed limitation as A4/A5/A6).

function uniqueViolation(field: string) {
  return new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on the fields: (\`${field}\`)`, {
    code: "P2002",
    clientVersion: "5.22.0",
    meta: { target: [field] },
  });
}

const mockTx = {
  tenant: { updateMany: vi.fn() },
  store: { create: vi.fn() },
  storeMembership: { create: vi.fn() },
  outboxEvent: { create: vi.fn() },
};

const mockDb = {
  tenant: { findUnique: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
};

vi.mock("@/server/db", () => ({ db: mockDb }));
vi.mock("@/server/identity/loginGuard", () => ({
  isIpRateLimited: vi.fn(async () => false),
  recordAttempt: vi.fn(async () => {}),
}));
vi.mock("@/server/identity/audit", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/server/identity/session", () => ({
  resolveSession: vi.fn(),
}));

const { createFirstStore } = await import("@/server/tenant/storeSetup");
const { isIpRateLimited } = await import("@/server/identity/loginGuard");
const { resolveSession } = await import("@/server/identity/session");

function baseSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "session-1",
    userId: "user-1",
    tenantId: "tenant-1",
    user: { id: "user-1", email: "owner@sharma-traders.example", tenantRole: "OWNER" },
    ...overrides,
  };
}

function baseInput(overrides: Partial<Parameters<typeof createFirstStore>[0]> = {}) {
  return {
    sessionToken: "session-token",
    name: "Main Store",
    code: "MAIN",
    storeType: "RETAIL" as const,
    currency: "INR",
    addressLine: "123 MG Road",
    city: "Bengaluru",
    state: "Karnataka",
    ip: "1.2.3.4",
    correlationId: "c1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx));
  vi.mocked(resolveSession).mockResolvedValue(baseSession() as never);
  mockDb.tenant.findUnique.mockResolvedValue({ id: "tenant-1", onboardingStep: "OWNER_CREATED" });
  mockTx.tenant.updateMany.mockResolvedValue({ count: 1 });
  mockTx.store.create.mockResolvedValue({ id: "store-1", name: "Main Store", code: "MAIN" });
  mockTx.storeMembership.create.mockResolvedValue({});
});

describe("createFirstStore", () => {
  it("returns unauthorized when the session cannot be resolved", async () => {
    vi.mocked(resolveSession).mockResolvedValueOnce(null);
    const result = await createFirstStore(baseInput());
    expect(result.status).toBe("unauthorized");
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("returns forbidden for a non-owner (STAFF) session", async () => {
    vi.mocked(resolveSession).mockResolvedValueOnce(
      baseSession({ user: { id: "user-2", email: "staff@sharma-traders.example", tenantRole: "STAFF" } }) as never,
    );
    const result = await createFirstStore(baseInput());
    expect(result.status).toBe("forbidden");
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("returns rate_limited without resolving the tenant", async () => {
    vi.mocked(isIpRateLimited).mockResolvedValueOnce(true);
    const result = await createFirstStore(baseInput());
    expect(result.status).toBe("rate_limited");
    expect(mockDb.tenant.findUnique).not.toHaveBeenCalled();
  });

  it("returns already_completed when the tenant is not at OWNER_CREATED", async () => {
    mockDb.tenant.findUnique.mockResolvedValueOnce({ id: "tenant-1", onboardingStep: "STORE_CREATED" });
    const result = await createFirstStore(baseInput());
    expect(result.status).toBe("already_completed");
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("never trusts a client-supplied tenant id — the session alone determines the tenant scope", async () => {
    // createFirstStore's input type has no tenantId field at all; this test documents
    // that guarantee by asserting the resolved session's tenantId is what's used.
    await createFirstStore(baseInput());
    expect(mockDb.tenant.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "tenant-1" } }));
  });

  it("creates the store, membership, and advances onboardingStep on a clean run", async () => {
    const result = await createFirstStore(baseInput());
    expect(result.status).toBe("ok");
    expect(mockTx.tenant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "tenant-1", onboardingStep: "OWNER_CREATED" }) }),
    );
    expect(mockTx.store.create).toHaveBeenCalledTimes(1);
    expect(mockTx.storeMembership.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "user-1", storeId: "store-1", role: "OWNER" }) }),
    );
  });

  it("returns store_conflict on a defensive store-code collision without creating a membership", async () => {
    mockTx.store.create.mockRejectedValueOnce(uniqueViolation("code"));
    const result = await createFirstStore(baseInput());
    expect(result.status).toBe("store_conflict");
    expect(mockTx.storeMembership.create).not.toHaveBeenCalled();
  });

  it("refuses a first store outside a registered business's GSTIN state, and allows any state without a GSTIN", async () => {
    mockDb.tenant.findUnique.mockResolvedValueOnce({ id: "tenant-1", onboardingStep: "OWNER_CREATED", taxId: "24ABCDE1234F1Z6" });
    const refused = await createFirstStore(baseInput({ state: "Karnataka" }));
    expect(refused).toMatchObject({ status: "state_outside_gstin", reason: expect.stringMatching(/registered in Gujarat/) });
    expect(mockDb.$transaction).not.toHaveBeenCalled();

    mockDb.tenant.findUnique.mockResolvedValueOnce({ id: "tenant-1", onboardingStep: "OWNER_CREATED", taxId: "24ABCDE1234F1Z6" });
    expect((await createFirstStore(baseInput({ state: "Gujarat" }))).status).toBe("ok");
    mockDb.tenant.findUnique.mockResolvedValueOnce({ id: "tenant-1", onboardingStep: "OWNER_CREATED", taxId: null });
    expect((await createFirstStore(baseInput({ state: "Karnataka" }))).status).toBe("ok");
  });

  it("the critical concurrency test: two simultaneous first-store attempts never both succeed", async () => {
    // Simulates two concurrent requests from the same owner (double-click / two tabs)
    // against the same tenant — only one claim can win.
    mockTx.tenant.updateMany.mockResolvedValueOnce({ count: 0 });
    const result = await createFirstStore(baseInput());
    expect(result.status).toBe("already_completed");
    // The critical assertion: losing the race must create neither a Store nor a StoreMembership.
    expect(mockTx.store.create).not.toHaveBeenCalled();
    expect(mockTx.storeMembership.create).not.toHaveBeenCalled();
  });
});
