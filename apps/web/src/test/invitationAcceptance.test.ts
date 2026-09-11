import { describe, expect, it, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// acceptInvitation touches Prisma (the atomic claim, user creation, membership creation),
// invitation resolution, session creation/resolution, the rate limiter, and audit logging —
// all mocked. The concurrency test below drives the *code's* lost-claim path by making the
// conditional `updateMany` return count 0, which is exactly what Postgres would do to the
// loser. It does NOT exercise real Postgres row locking under genuine parallel load — no
// live database is available in this sandbox (same disclosed limitation as A4-A8).

function uniqueViolation(field: string) {
  return new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on the fields: (\`${field}\`)`, {
    code: "P2002",
    clientVersion: "5.22.0",
    meta: { target: [field] },
  });
}

const mockTx = {
  invitation: { updateMany: vi.fn(), update: vi.fn() },
  user: { create: vi.fn(), findUnique: vi.fn() },
  storeMembership: { create: vi.fn() },
};

const mockDb = {
  user: { findUnique: vi.fn() },
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
  resolveSession: vi.fn(async () => null),
}));
vi.mock("@/server/tenant/invitation", () => ({
  resolveInvitation: vi.fn(),
  previewInvitation: vi.fn(async () => ({ status: "invalid" })),
}));

const { acceptInvitation } = await import("@/server/tenant/invitationAcceptance");
const { resolveInvitation, previewInvitation } = await import("@/server/tenant/invitation");
const { createSession, resolveSession } = await import("@/server/identity/session");
const { isIpRateLimited } = await import("@/server/identity/loginGuard");

const TOKEN = "a".repeat(64);

function pendingInvitation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "inv-1",
    tenantId: "tenant-1",
    storeId: "store-1",
    email: "new.hire@example.com",
    role: "CASHIER",
    acceptedAt: null,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    tenant: { name: "Sharma Traders" },
    store: { name: "Main Store" },
    ...overrides,
  };
}

function newUserInput(overrides: Partial<Parameters<typeof acceptInvitation>[0]> = {}) {
  return {
    token: TOKEN,
    name: "Priya Sharma",
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
  vi.mocked(resolveInvitation).mockResolvedValue(pendingInvitation() as never);
  vi.mocked(resolveSession).mockResolvedValue(null as never);
  mockDb.user.findUnique.mockResolvedValue(null);
  mockTx.invitation.updateMany.mockResolvedValue({ count: 1 });
  mockTx.user.create.mockResolvedValue({ id: "user-new", name: "Priya Sharma", email: "new.hire@example.com" });
  mockTx.user.findUnique.mockResolvedValue({ id: "user-existing", name: "Priya", email: "new.hire@example.com" });
  mockTx.storeMembership.create.mockResolvedValue({});
});

describe("acceptInvitation — new user", () => {
  it("creates the user, binds acceptance, creates the membership, and issues a session", async () => {
    const result = await acceptInvitation(newUserInput());
    expect(result.status).toBe("ok");
    expect(mockTx.user.create).toHaveBeenCalledTimes(1);
    expect(mockTx.storeMembership.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ storeId: "store-1", role: "CASHIER" }) }),
    );
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("always creates the invited user as tenant STAFF, never OWNER", async () => {
    await acceptInvitation(newUserInput());
    expect(mockTx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tenantRole: "STAFF" }) }),
    );
  });

  it("uses the invitation's email, ignoring anything the client might send", async () => {
    await acceptInvitation(newUserInput());
    expect(mockTx.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: "new.hire@example.com" }) }),
    );
  });

  it("claims the invitation with the full conditional guard before creating anything", async () => {
    await acceptInvitation(newUserInput());
    expect(mockTx.invitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "inv-1", acceptedAt: null, revokedAt: null }),
      }),
    );
  });

  it("rejects a weak password before opening the transaction", async () => {
    const result = await acceptInvitation(newUserInput({ password: "weak" }));
    expect(result.status).toBe("weak_password");
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("requires a name on the new-account path", async () => {
    const result = await acceptInvitation(newUserInput({ name: "" }));
    expect(result.status).toBe("validation_error");
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });
});

describe("acceptInvitation — existing user", () => {
  beforeEach(() => {
    mockDb.user.findUnique.mockResolvedValue({
      id: "user-existing",
      email: "new.hire@example.com",
      tenantId: "tenant-1",
      status: "ACTIVE",
    });
  });

  it("refuses to proceed without an authenticated session — a token alone is not identity", async () => {
    const result = await acceptInvitation({ token: TOKEN, ip: "1.2.3.4", userAgent: null, correlationId: "c1" });
    expect(result.status).toBe("login_required");
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("never mints a session for an existing account, even on success", async () => {
    vi.mocked(resolveSession).mockResolvedValue({
      userId: "user-existing",
      tenantId: "tenant-1",
      user: { id: "user-existing", email: "new.hire@example.com" },
    } as never);

    const result = await acceptInvitation({
      token: TOKEN,
      sessionToken: "existing-session",
      ip: "1.2.3.4",
      userAgent: null,
      correlationId: "c1",
    });

    expect(result.status).toBe("ok");
    expect(mockTx.user.create).not.toHaveBeenCalled();
    expect(mockTx.storeMembership.create).toHaveBeenCalledTimes(1);
    expect(createSession).not.toHaveBeenCalled();
    if (result.status === "ok") expect(result.sessionToken).toBeUndefined();
  });

  it("blocks a signed-in Bob from accepting Alice's invitation", async () => {
    vi.mocked(resolveSession).mockResolvedValue({
      userId: "bob",
      tenantId: "tenant-1",
      user: { id: "bob", email: "bob@example.com" },
    } as never);

    const result = await acceptInvitation({
      token: TOKEN,
      sessionToken: "bobs-session",
      ip: "1.2.3.4",
      userAgent: null,
      correlationId: "c1",
    });

    expect(result.status).toBe("identity_mismatch");
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(mockTx.storeMembership.create).not.toHaveBeenCalled();
  });

  it("blocks an account that has since been created under a different tenant", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: "user-elsewhere",
      email: "new.hire@example.com",
      tenantId: "some-other-tenant",
      status: "ACTIVE",
    });
    const result = await acceptInvitation({ token: TOKEN, ip: "1.2.3.4", userAgent: null, correlationId: "c1" });
    expect(result.status).toBe("identity_conflict");
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("blocks a disabled account", async () => {
    mockDb.user.findUnique.mockResolvedValue({
      id: "user-existing",
      email: "new.hire@example.com",
      tenantId: "tenant-1",
      status: "DISABLED",
    });
    const result = await acceptInvitation({ token: TOKEN, ip: "1.2.3.4", userAgent: null, correlationId: "c1" });
    expect(result.status).toBe("account_disabled");
  });
});

describe("acceptInvitation — invalid invitation states", () => {
  it("reports expired", async () => {
    vi.mocked(resolveInvitation).mockResolvedValueOnce(null as never);
    vi.mocked(previewInvitation).mockResolvedValueOnce({ status: "EXPIRED" } as never);
    const result = await acceptInvitation(newUserInput());
    expect(result.status).toBe("expired");
  });

  it("reports revoked", async () => {
    vi.mocked(resolveInvitation).mockResolvedValueOnce(null as never);
    vi.mocked(previewInvitation).mockResolvedValueOnce({ status: "REVOKED" } as never);
    const result = await acceptInvitation(newUserInput());
    expect(result.status).toBe("revoked");
  });

  it("reports already accepted (replay of a used link)", async () => {
    vi.mocked(resolveInvitation).mockResolvedValueOnce(null as never);
    vi.mocked(previewInvitation).mockResolvedValueOnce({ status: "ACCEPTED" } as never);
    const result = await acceptInvitation(newUserInput());
    expect(result.status).toBe("already_accepted");
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("reports invalid for an unknown token", async () => {
    vi.mocked(resolveInvitation).mockResolvedValueOnce(null as never);
    vi.mocked(previewInvitation).mockResolvedValueOnce({ status: "invalid" } as never);
    const result = await acceptInvitation(newUserInput());
    expect(result.status).toBe("invalid");
  });

  it("rejects an invitation whose stored role is no longer invitable", async () => {
    vi.mocked(resolveInvitation).mockResolvedValueOnce(pendingInvitation({ role: "OWNER" }) as never);
    const result = await acceptInvitation(newUserInput());
    expect(result.status).toBe("invalid");
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("returns rate_limited without resolving the invitation", async () => {
    vi.mocked(isIpRateLimited).mockResolvedValueOnce(true);
    const result = await acceptInvitation(newUserInput());
    expect(result.status).toBe("rate_limited");
    expect(resolveInvitation).not.toHaveBeenCalled();
  });
});

describe("acceptInvitation — concurrency (the A11 invariant)", () => {
  it("two concurrent acceptances: the loser creates no user, no membership, no session", async () => {
    // The loser's conditional claim matches zero rows — exactly what Postgres returns to
    // the second transaction once the first has committed `acceptedAt`.
    mockTx.invitation.updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await acceptInvitation(newUserInput());

    expect(result.status).toBe("already_accepted");
    expect(mockTx.user.create).not.toHaveBeenCalled();
    expect(mockTx.storeMembership.create).not.toHaveBeenCalled();
    expect(mockTx.invitation.update).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("the winner still completes normally when the loser lost", async () => {
    // Winner first (count 1), then a second attempt on the same invitation (count 0).
    mockTx.invitation.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    const winner = await acceptInvitation(newUserInput());
    const loser = await acceptInvitation(newUserInput());

    expect(winner.status).toBe("ok");
    expect(loser.status).toBe("already_accepted");
    // Exactly one user and one membership across both attempts.
    expect(mockTx.user.create).toHaveBeenCalledTimes(1);
    expect(mockTx.storeMembership.create).toHaveBeenCalledTimes(1);
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("falls back to the membership unique constraint if one somehow slips through", async () => {
    mockTx.storeMembership.create.mockRejectedValueOnce(uniqueViolation("userId"));
    const result = await acceptInvitation(newUserInput());
    expect(result.status).toBe("already_member");
    expect(createSession).not.toHaveBeenCalled();
  });

  it("treats a concurrent signup taking the email as an identity conflict, not a crash", async () => {
    mockTx.user.create.mockRejectedValueOnce(uniqueViolation("email"));
    const result = await acceptInvitation(newUserInput());
    expect(result.status).toBe("identity_conflict");
    expect(createSession).not.toHaveBeenCalled();
  });
});
