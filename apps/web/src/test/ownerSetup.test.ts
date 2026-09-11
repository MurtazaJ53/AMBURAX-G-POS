import { describe, expect, it, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// createOwnerAccount touches Prisma (including the P2002 email-uniqueness path and the
// atomic onboardingStep claim), the onboarding-session resolver, session creation, the
// login-attempt guard, and audit logging — all mocked. This proves the *code's* handling
// of a lost concurrent-owner race, not Postgres's actual row-lock behavior under real
// load (no live database in this sandbox — same disclosed limitation as A4/A5).

function uniqueViolation(field: string) {
  return new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on the fields: (\`${field}\`)`, {
    code: "P2002",
    clientVersion: "5.22.0",
    meta: { target: [field] },
  });
}

const mockTx = {
  tenant: {
    updateMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  user: { create: vi.fn() },
};

const mockDb = {
  $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
};

vi.mock("@/server/db", () => ({ db: mockDb }));
vi.mock("@/server/identity/loginGuard", () => ({
  isIpRateLimited: vi.fn(async () => false),
  recordAttempt: vi.fn(async () => {}),
}));
vi.mock("@/server/identity/audit", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/server/identity/session", () => ({
  createSession: vi.fn(async ({ userId }: { userId: string }) => ({
    token: `session-for-${userId}`,
    expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
  })),
}));
vi.mock("@/server/tenant/onboardingSession", () => ({
  resolveOnboardingSession: vi.fn(),
}));

const { createOwnerAccount } = await import("@/server/tenant/ownerSetup");
const { isIpRateLimited } = await import("@/server/identity/loginGuard");
const { resolveOnboardingSession } = await import("@/server/tenant/onboardingSession");
const { createSession } = await import("@/server/identity/session");

const VALID_TOKEN = "a".repeat(64);

function baseSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "onboarding-1",
    tenantId: "tenant-1",
    tenant: { id: "tenant-1", name: "Sharma Traders", onboardingStep: "BUSINESS_CREATED" },
    ...overrides,
  };
}

function baseInput(overrides: Partial<Parameters<typeof createOwnerAccount>[0]> = {}) {
  return {
    onboardingToken: VALID_TOKEN,
    name: "Priya Sharma",
    email: "priya@sharma-traders.example",
    password: "Correct-Horse-9",
    ip: "1.2.3.4",
    userAgent: null,
    correlationId: "c1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx));
  vi.mocked(resolveOnboardingSession).mockResolvedValue(baseSession() as never);
  mockTx.tenant.updateMany.mockResolvedValue({ count: 1 });
  mockTx.user.create.mockResolvedValue({ id: "user-1", name: "Priya Sharma", email: "priya@sharma-traders.example" });
  mockTx.tenant.findUniqueOrThrow.mockResolvedValue({ id: "tenant-1", name: "Sharma Traders" });
});

describe("createOwnerAccount", () => {
  it("returns rate_limited without resolving the onboarding session", async () => {
    vi.mocked(isIpRateLimited).mockResolvedValueOnce(true);
    const result = await createOwnerAccount(baseInput());
    expect(result.status).toBe("rate_limited");
    expect(resolveOnboardingSession).not.toHaveBeenCalled();
  });

  it("returns invalid_session for an unresolvable onboarding token", async () => {
    vi.mocked(resolveOnboardingSession).mockResolvedValueOnce(null);
    const result = await createOwnerAccount(baseInput());
    expect(result.status).toBe("invalid_session");
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("returns already_completed when the tenant has moved past BUSINESS_CREATED", async () => {
    vi.mocked(resolveOnboardingSession).mockResolvedValueOnce(
      baseSession({ tenant: { id: "tenant-1", name: "Sharma Traders", onboardingStep: "OWNER_CREATED" } }) as never,
    );
    const result = await createOwnerAccount(baseInput());
    expect(result.status).toBe("already_completed");
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a weak password before touching the transaction", async () => {
    const result = await createOwnerAccount(baseInput({ password: "weak" }));
    expect(result.status).toBe("weak_password");
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("returns email_taken when another user already has that email, and does not create a session", async () => {
    mockTx.user.create.mockRejectedValueOnce(uniqueViolation("email"));
    const result = await createOwnerAccount(baseInput());
    expect(result.status).toBe("email_taken");
    expect(createSession).not.toHaveBeenCalled();
  });

  it("creates the owner, transitions onboardingStep, and issues a real session on success", async () => {
    const result = await createOwnerAccount(baseInput());
    expect(result.status).toBe("ok");
    expect(mockTx.tenant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "tenant-1", onboardingStep: "BUSINESS_CREATED" }) }),
    );
    expect(mockTx.user.create).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-1", tenantId: "tenant-1" }));
  });

  it("the concurrent-owner fix: loses the step claim when another request already created the owner", async () => {
    // Simulates two concurrent submissions against the same onboarding session — both
    // resolve the session and see BUSINESS_CREATED, but only one can win the atomic claim.
    mockTx.tenant.updateMany.mockResolvedValueOnce({ count: 0 });
    const result = await createOwnerAccount(baseInput());
    expect(result.status).toBe("already_completed");
    // The critical assertion: losing the race must not create a user or a session.
    expect(mockTx.user.create).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });
});
