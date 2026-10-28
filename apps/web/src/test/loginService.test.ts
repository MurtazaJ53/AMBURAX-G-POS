import { beforeEach, describe, expect, it, vi } from "vitest";

const db = { user: { findUnique: vi.fn() } };
vi.mock("@/server/db", () => ({ db }));

const verifyPassword = vi.fn();
vi.mock("@/server/identity/password", () => ({ verifyPassword, TIMING_SAFETY_DUMMY_HASH: "dummy-hash" }));

const guard = {
  isIpRateLimited: vi.fn(),
  isAccountLocked: vi.fn((until: Date | null) => Boolean(until && until.getTime() > Date.now())),
  recordAttempt: vi.fn(),
  registerFailedAttempt: vi.fn(),
  clearFailedAttempts: vi.fn(),
};
vi.mock("@/server/identity/loginGuard", () => guard);

const createSession = vi.fn();
vi.mock("@/server/identity/session", () => ({ createSession }));
const writeAuditLog = vi.fn();
vi.mock("@/server/identity/audit", () => ({ writeAuditLog }));
const createMfaChallenge = vi.fn();
vi.mock("@/server/identity/mfaChallenge", () => ({ createMfaChallenge }));

const { login } = await import("@/server/identity/loginService");

const params = { email: "  Owner@Example.TEST ", password: "pw", ip: "10.0.0.1", userAgent: "ua", correlationId: "c1" };

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: "u1",
    tenantId: "t1",
    name: "Owner",
    email: "owner@example.test",
    passwordHash: "hash",
    status: "ACTIVE",
    lockedUntil: null,
    mfaEnabled: false,
    tenant: { id: "t1", name: "Shop" },
    memberships: [{}, {}],
    ...overrides,
  };
}

const actions = () => writeAuditLog.mock.calls.map((c) => (c[0] as { action: string }).action);

beforeEach(() => {
  vi.clearAllMocks();
  guard.isIpRateLimited.mockResolvedValue(false);
  guard.registerFailedAttempt.mockResolvedValue({ lockedUntil: null });
  createSession.mockResolvedValue({ token: "sess", expiresAt: new Date("2026-11-01T00:00:00Z") });
});

describe("login", () => {
  it("refuses a rate-limited IP before looking the user up", async () => {
    guard.isIpRateLimited.mockResolvedValue(true);
    expect(await login(params)).toEqual({ status: "rate_limited" });
    expect(db.user.findUnique).not.toHaveBeenCalled();
    expect(actions()).toEqual(["LoginRateLimited"]);
  });

  it("normalises the email and spends a password check on an unknown user", async () => {
    db.user.findUnique.mockResolvedValue(null);
    expect(await login(params)).toEqual({ status: "invalid_credentials" });
    expect(db.user.findUnique.mock.calls[0]![0].where).toEqual({ email: "owner@example.test" });
    expect(verifyPassword).toHaveBeenCalledWith("pw", "dummy-hash");
    expect(guard.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({ success: false, reason: "no_such_user" }));
  });

  it("reports a locked account without checking the password", async () => {
    const until = new Date(Date.now() + 60_000);
    db.user.findUnique.mockResolvedValue(user({ lockedUntil: until }));
    expect(await login(params)).toEqual({ status: "account_locked", lockedUntil: until.toISOString() });
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it("blocks a disabled account and audits it", async () => {
    db.user.findUnique.mockResolvedValue(user({ status: "DISABLED" }));
    expect(await login(params)).toEqual({ status: "account_disabled" });
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(actions()).toEqual(["LoginBlockedDisabledAccount"]);
  });

  it("counts a wrong password and returns the generic failure", async () => {
    db.user.findUnique.mockResolvedValue(user());
    verifyPassword.mockResolvedValue(false);
    expect(await login(params)).toEqual({ status: "invalid_credentials" });
    expect(guard.registerFailedAttempt).toHaveBeenCalledWith("u1");
    expect(createSession).not.toHaveBeenCalled();
    expect(actions()).toEqual(["LoginFailed"]);
  });

  it("locks the account on the failure that crosses the threshold", async () => {
    const until = new Date("2026-11-01T00:15:00Z");
    db.user.findUnique.mockResolvedValue(user());
    verifyPassword.mockResolvedValue(false);
    guard.registerFailedAttempt.mockResolvedValue({ lockedUntil: until });
    expect(await login(params)).toEqual({ status: "account_locked", lockedUntil: until.toISOString() });
  });

  it("issues an MFA challenge instead of a session when MFA is on", async () => {
    db.user.findUnique.mockResolvedValue(user({ mfaEnabled: true }));
    verifyPassword.mockResolvedValue(true);
    createMfaChallenge.mockResolvedValue({ challengeToken: "ch", expiresAt: "x", maskedDestination: "o***@example.test" });
    const result = await login(params);
    expect(result).toEqual({ status: "mfa_required", challengeToken: "ch", expiresAt: "x", maskedDestination: "o***@example.test" });
    expect(createSession).not.toHaveBeenCalled();
    expect(guard.clearFailedAttempts).toHaveBeenCalledWith("u1");
  });

  it("signs in: clears failures, creates a session and audits success", async () => {
    db.user.findUnique.mockResolvedValue(user());
    verifyPassword.mockResolvedValue(true);
    expect(await login(params)).toEqual({
      status: "ok",
      sessionToken: "sess",
      expiresAt: "2026-11-01T00:00:00.000Z",
      user: { id: "u1", name: "Owner", email: "owner@example.test" },
      tenant: { id: "t1", name: "Shop" },
      storeCount: 2,
    });
    expect(guard.recordAttempt).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(guard.clearFailedAttempts).toHaveBeenCalledWith("u1");
    expect(actions()).toEqual(["LoginSucceeded"]);
  });
});
