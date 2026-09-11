import { describe, expect, it, vi, beforeEach } from "vitest";

// createInvitation/resendInvitation/revokeInvitation touch Prisma, session resolution,
// the login-attempt guard, the notifier, and audit logging — all mocked. The concurrent
// double-invite fix is verified here by asserting the code calls a single atomic `upsert`
// (INSERT ... ON CONFLICT DO UPDATE) rather than a separate read-then-write — that's the
// property that makes the race impossible, and it's what a mock can actually prove. It
// does not prove Postgres's own unique-constraint/upsert behavior under real concurrent
// load (no live database in this sandbox — same disclosed limitation as every prior screen).

const mockDb = {
  store: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  storeMembership: { findUnique: vi.fn() },
  tenant: { findUnique: vi.fn() },
  invitation: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
};

vi.mock("@/server/db", () => ({ db: mockDb }));
vi.mock("@/server/identity/loginGuard", () => ({
  isIpRateLimited: vi.fn(async () => false),
  recordAttempt: vi.fn(async () => {}),
}));
vi.mock("@/server/identity/audit", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/server/identity/session", () => ({ resolveSession: vi.fn() }));
vi.mock("@/server/identity/notifier", () => ({
  identityNotifier: { sendInvitation: vi.fn(async () => {}) },
}));

const { createInvitation, resendInvitation, revokeInvitation, deriveInvitationStatus } = await import(
  "@/server/tenant/invitation"
);
const { resolveSession } = await import("@/server/identity/session");
const { identityNotifier } = await import("@/server/identity/notifier");

function ownerSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "session-1",
    userId: "owner-1",
    tenantId: "tenant-1",
    user: { id: "owner-1", email: "owner@sharma-traders.example", tenantRole: "OWNER" },
    ...overrides,
  };
}

function baseCreateInput(overrides: Partial<Parameters<typeof createInvitation>[0]> = {}) {
  return {
    sessionToken: "session-token",
    storeId: "store-1",
    email: "new.hire@example.com",
    role: "CASHIER",
    ip: "1.2.3.4",
    correlationId: "c1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveSession).mockResolvedValue(ownerSession() as never);
  mockDb.store.findUnique.mockResolvedValue({ id: "store-1", tenantId: "tenant-1", name: "Main Store" });
  mockDb.user.findUnique.mockResolvedValue(null);
  mockDb.tenant.findUnique.mockResolvedValue({ id: "tenant-1", name: "Sharma Traders" });
  mockDb.invitation.upsert.mockResolvedValue({
    id: "inv-1",
    email: "new.hire@example.com",
    role: "CASHIER",
    storeId: "store-1",
    expiresAt: new Date(Date.now() + 1000 * 60 * 60),
  });
});

describe("createInvitation", () => {
  it("returns unauthorized without touching the database", async () => {
    vi.mocked(resolveSession).mockResolvedValueOnce(null);
    const result = await createInvitation(baseCreateInput());
    expect(result.status).toBe("unauthorized");
    expect(mockDb.store.findUnique).not.toHaveBeenCalled();
  });

  it("returns forbidden for a STAFF inviter", async () => {
    vi.mocked(resolveSession).mockResolvedValueOnce(
      ownerSession({ user: { id: "staff-1", email: "staff@sharma-traders.example", tenantRole: "STAFF" } }) as never,
    );
    const result = await createInvitation(baseCreateInput());
    expect(result.status).toBe("forbidden");
    expect(mockDb.invitation.upsert).not.toHaveBeenCalled();
  });

  it("rejects OWNER as a requested role — no privilege escalation through the payload", async () => {
    const result = await createInvitation(baseCreateInput({ role: "OWNER" }));
    expect(result.status).toBe("invalid_role");
    expect(mockDb.invitation.upsert).not.toHaveBeenCalled();
  });

  it("rejects a store belonging to another tenant with the same response as a missing store", async () => {
    mockDb.store.findUnique.mockResolvedValueOnce({ id: "store-x", tenantId: "some-other-tenant", name: "Someone Else's Store" });
    const result = await createInvitation(baseCreateInput());
    expect(result.status).toBe("invalid_store");
    expect(mockDb.invitation.upsert).not.toHaveBeenCalled();
  });

  it("rejects an email that already belongs to a different tenant", async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({ id: "user-x", tenantId: "some-other-tenant" });
    const result = await createInvitation(baseCreateInput());
    expect(result.status).toBe("email_unavailable");
    expect(mockDb.invitation.upsert).not.toHaveBeenCalled();
  });

  it("rejects inviting an existing tenant member who already has this store's membership", async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({ id: "user-existing", tenantId: "tenant-1" });
    mockDb.storeMembership.findUnique.mockResolvedValueOnce({ id: "membership-1" });
    const result = await createInvitation(baseCreateInput());
    expect(result.status).toBe("already_member");
    expect(mockDb.invitation.upsert).not.toHaveBeenCalled();
  });

  it("allows inviting an existing tenant member to a second store they don't yet have", async () => {
    mockDb.user.findUnique.mockResolvedValueOnce({ id: "user-existing", tenantId: "tenant-1" });
    mockDb.storeMembership.findUnique.mockResolvedValueOnce(null);
    const result = await createInvitation(baseCreateInput());
    expect(result.status).toBe("ok");
  });

  it("the concurrency fix: creates via a single atomic upsert, not a read-then-write", async () => {
    const result = await createInvitation(baseCreateInput());
    expect(result.status).toBe("ok");
    expect(mockDb.invitation.upsert).toHaveBeenCalledTimes(1);
    expect(mockDb.invitation.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_storeId_email: { tenantId: "tenant-1", storeId: "store-1", email: "new.hire@example.com" } },
      }),
    );
    expect(identityNotifier.sendInvitation).toHaveBeenCalledTimes(1);
  });

  it("never returns the raw invitation token to the caller", async () => {
    const result = await createInvitation(baseCreateInput());
    expect(JSON.stringify(result)).not.toMatch(/token/i);
  });
});

describe("resendInvitation", () => {
  function pendingInvitation(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: "inv-1",
      tenantId: "tenant-1",
      email: "new.hire@example.com",
      role: "CASHIER",
      lastSentAt: new Date(Date.now() - 1000 * 60 * 60),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      acceptedAt: null,
      revokedAt: null,
      store: { name: "Main Store" },
      ...overrides,
    };
  }

  it("returns not_found for an invitation belonging to another tenant", async () => {
    mockDb.invitation.findUnique.mockResolvedValueOnce(pendingInvitation({ tenantId: "some-other-tenant" }));
    const result = await resendInvitation({ sessionToken: "t", invitationId: "inv-1", ip: "1.2.3.4", correlationId: "c1" });
    expect(result.status).toBe("not_found");
  });

  it("refuses to resend an already-accepted invitation", async () => {
    mockDb.invitation.findUnique.mockResolvedValueOnce(pendingInvitation({ acceptedAt: new Date() }));
    const result = await resendInvitation({ sessionToken: "t", invitationId: "inv-1", ip: "1.2.3.4", correlationId: "c1" });
    expect(result.status).toBe("invalid_state");
    expect(mockDb.invitation.update).not.toHaveBeenCalled();
  });

  it("enforces the resend cooldown", async () => {
    mockDb.invitation.findUnique.mockResolvedValueOnce(pendingInvitation({ lastSentAt: new Date() }));
    const result = await resendInvitation({ sessionToken: "t", invitationId: "inv-1", ip: "1.2.3.4", correlationId: "c1" });
    expect(result.status).toBe("cooldown");
  });

  it("regenerates the token and refreshes expiry on a clean resend", async () => {
    mockDb.invitation.findUnique.mockResolvedValueOnce(pendingInvitation());
    const result = await resendInvitation({ sessionToken: "t", invitationId: "inv-1", ip: "1.2.3.4", correlationId: "c1" });
    expect(result.status).toBe("ok");
    expect(mockDb.invitation.update).toHaveBeenCalledTimes(1);
  });
});

describe("revokeInvitation", () => {
  it("returns already_accepted and makes no change for an accepted invitation", async () => {
    mockDb.invitation.findUnique.mockResolvedValueOnce({ id: "inv-1", tenantId: "tenant-1", acceptedAt: new Date(), revokedAt: null });
    const result = await revokeInvitation({ sessionToken: "t", invitationId: "inv-1", correlationId: "c1" });
    expect(result.status).toBe("already_accepted");
    expect(mockDb.invitation.update).not.toHaveBeenCalled();
  });

  it("is idempotent: revoking an already-revoked invitation is a safe no-op success", async () => {
    mockDb.invitation.findUnique.mockResolvedValueOnce({ id: "inv-1", tenantId: "tenant-1", acceptedAt: null, revokedAt: new Date() });
    const result = await revokeInvitation({ sessionToken: "t", invitationId: "inv-1", correlationId: "c1" });
    expect(result.status).toBe("ok");
    expect(mockDb.invitation.update).not.toHaveBeenCalled();
  });

  it("revokes a live pending invitation", async () => {
    mockDb.invitation.findUnique.mockResolvedValueOnce({ id: "inv-1", tenantId: "tenant-1", acceptedAt: null, revokedAt: null });
    const result = await revokeInvitation({ sessionToken: "t", invitationId: "inv-1", correlationId: "c1" });
    expect(result.status).toBe("ok");
    expect(mockDb.invitation.update).toHaveBeenCalledTimes(1);
  });
});

describe("deriveInvitationStatus", () => {
  it("prioritizes accepted over everything else", () => {
    expect(
      deriveInvitationStatus({ acceptedAt: new Date(), revokedAt: new Date(), expiresAt: new Date(Date.now() - 1000) }),
    ).toBe("ACCEPTED");
  });

  it("is expired once past expiresAt with no accept/revoke", () => {
    expect(deriveInvitationStatus({ acceptedAt: null, revokedAt: null, expiresAt: new Date(Date.now() - 1000) })).toBe(
      "EXPIRED",
    );
  });

  it("is pending otherwise", () => {
    expect(deriveInvitationStatus({ acceptedAt: null, revokedAt: null, expiresAt: new Date(Date.now() + 1000) })).toBe(
      "PENDING",
    );
  });
});
