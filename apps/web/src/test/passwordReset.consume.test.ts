import { describe, expect, it, vi, beforeEach } from "vitest";

// consumePasswordReset touches Prisma, the login-attempt guard, and audit logging.
// This test mocks all three to exercise the token-claim race-condition fix in isolation:
// it proves the *code's* response to "another request already claimed this token"
// (updateMany returning count: 0), not Postgres's own transaction isolation, which
// this sandbox has no live database to verify against — see README's known-gaps note.

const mockTx = {
  passwordResetToken: {
    updateMany: vi.fn(),
  },
  user: {
    update: vi.fn(),
  },
  session: {
    updateMany: vi.fn(),
  },
};

const mockDb = {
  passwordResetToken: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx)),
};

vi.mock("@/server/db", () => ({ db: mockDb }));
vi.mock("@/server/identity/loginGuard", () => ({
  isIpRateLimited: vi.fn(async () => false),
  recordAttempt: vi.fn(async () => {}),
}));
vi.mock("@/server/identity/audit", () => ({ writeAuditLog: vi.fn(async () => {}) }));

const { consumePasswordReset } = await import("@/server/identity/passwordReset");
const { hashPassword } = await import("@/server/identity/password");
const { hashOpaqueToken, generateOpaqueToken } = await import("@/server/identity/token");

const VALID_TOKEN = generateOpaqueToken();
const NEW_PASSWORD = "Correct-Horse-9";

function baseRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "token-1",
    userId: "user-1",
    tenantId: "tenant-1",
    tokenHash: hashOpaqueToken(VALID_TOKEN),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    consumedAt: null,
    user: { id: "user-1", email: "owner@demo.amburax.test", passwordHash: "" },
    ...overrides,
  };
}

// hashPassword is real bcrypt (cost 12) — give the hook the same headroom as the tests.
beforeEach(async () => {
  vi.clearAllMocks();
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx));
  const otherPasswordHash = await hashPassword("something-else-1");
  mockDb.passwordResetToken.findUnique.mockResolvedValue(
    baseRecord({ user: { id: "user-1", email: "owner@demo.amburax.test", passwordHash: otherPasswordHash } }),
  );
  mockTx.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
}, 60_000);

describe("consumePasswordReset", { timeout: 60_000 }, () => {
  it("returns invalid for a token that was never issued", async () => {
    mockDb.passwordResetToken.findUnique.mockResolvedValueOnce(null);
    const result = await consumePasswordReset({ token: VALID_TOKEN, newPassword: NEW_PASSWORD, ip: "1.2.3.4", correlationId: "c1" });
    expect(result.status).toBe("invalid");
    expect(mockTx.user.update).not.toHaveBeenCalled();
  });

  it("returns invalid for an already-consumed token (replay)", async () => {
    mockDb.passwordResetToken.findUnique.mockResolvedValueOnce(baseRecord({ consumedAt: new Date() }));
    const result = await consumePasswordReset({ token: VALID_TOKEN, newPassword: NEW_PASSWORD, ip: "1.2.3.4", correlationId: "c1" });
    expect(result.status).toBe("invalid");
    expect(mockTx.user.update).not.toHaveBeenCalled();
  });

  it("returns expired for a token past its expiry", async () => {
    mockDb.passwordResetToken.findUnique.mockResolvedValueOnce(baseRecord({ expiresAt: new Date(Date.now() - 1000) }));
    const result = await consumePasswordReset({ token: VALID_TOKEN, newPassword: NEW_PASSWORD, ip: "1.2.3.4", correlationId: "c1" });
    expect(result.status).toBe("expired");
    expect(mockTx.user.update).not.toHaveBeenCalled();
  });

  it("rejects a weak new password without touching the transaction", async () => {
    const result = await consumePasswordReset({ token: VALID_TOKEN, newPassword: "weak", ip: "1.2.3.4", correlationId: "c1" });
    expect(result.status).toBe("weak_password");
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a new password identical to the current one", async () => {
    const currentHash = await hashPassword(NEW_PASSWORD);
    mockDb.passwordResetToken.findUnique.mockResolvedValueOnce(
      baseRecord({ user: { id: "user-1", email: "owner@demo.amburax.test", passwordHash: currentHash } }),
    );
    const result = await consumePasswordReset({ token: VALID_TOKEN, newPassword: NEW_PASSWORD, ip: "1.2.3.4", correlationId: "c1" });
    expect(result.status).toBe("same_as_current");
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("changes the password and revokes sessions on a clean, uncontested claim", async () => {
    const result = await consumePasswordReset({ token: VALID_TOKEN, newPassword: NEW_PASSWORD, ip: "1.2.3.4", correlationId: "c1" });
    expect(result.status).toBe("ok");
    expect(mockTx.passwordResetToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "token-1", consumedAt: null }) }),
    );
    expect(mockTx.user.update).toHaveBeenCalledTimes(1);
    expect(mockTx.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: "user-1", revokedAt: null }) }),
    );
  });

  it("the race fix: loses the claim when another request consumed the token first", async () => {
    // Simulates two concurrent requests both passing the initial findUnique check, then
    // racing on the atomic claim — the loser's updateMany matches zero rows.
    mockTx.passwordResetToken.updateMany.mockResolvedValueOnce({ count: 0 });
    const result = await consumePasswordReset({ token: VALID_TOKEN, newPassword: NEW_PASSWORD, ip: "1.2.3.4", correlationId: "c1" });
    expect(result.status).toBe("invalid");
    // The critical assertion: losing the race must not change the password or touch sessions.
    expect(mockTx.user.update).not.toHaveBeenCalled();
    expect(mockTx.session.updateMany).not.toHaveBeenCalled();
  });
});
