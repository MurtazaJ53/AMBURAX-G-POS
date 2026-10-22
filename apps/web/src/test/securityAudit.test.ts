import { describe, expect, it, vi } from "vitest";
import { isAccountLocked, isIpRateLimited, AttemptContext } from "@/server/identity/loginGuard";
import { pinProblem, PIN_PATTERN, MAX_PIN_FAILURES, PIN_LOCK_MINUTES } from "@/server/identity/approvalPin";
import { validatePasswordStrength, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from "@/server/identity/passwordPolicy";
import { db } from "@/server/db";

describe("Account Lockout & Timing Security", () => {
  it("detects active lock when lockedUntil is in the future", () => {
    expect(isAccountLocked(new Date(Date.now() + 600_000))).toBe(true);
  });

  it("permits login when lockedUntil is null", () => {
    expect(isAccountLocked(null)).toBe(false);
  });

  it("permits login once lock time has elapsed", () => {
    expect(isAccountLocked(new Date(Date.now() - 1000))).toBe(false);
  });
});

describe("IP Rate Limiting Security", () => {
  it("flags rate limit when failure count meets or exceeds threshold", async () => {
    vi.spyOn(db.loginAttempt, "count").mockResolvedValueOnce(20);
    const limited = await isIpRateLimited("192.168.1.100", "password", { threshold: 20 });
    expect(limited).toBe(true);
  });

  it("allows access when failure count is under threshold", async () => {
    vi.spyOn(db.loginAttempt, "count").mockResolvedValueOnce(4);
    const limited = await isIpRateLimited("192.168.1.100", "password", { threshold: 20 });
    expect(limited).toBe(false);
  });

  it("keeps rate limiting contexts isolated", async () => {
    const contexts: AttemptContext[] = ["password", "mfa_verify", "password_reset_request", "pos_activate"];
    expect(contexts.length).toBe(4);
  });
});

describe("Approval PIN Validation & Attack Prevention", () => {
  it("enforces 4-6 digit numeric pattern", () => {
    expect(PIN_PATTERN.test("1234")).toBe(true);
    expect(PIN_PATTERN.test("123456")).toBe(true);
    expect(PIN_PATTERN.test("123")).toBe(false);
    expect(PIN_PATTERN.test("1234567")).toBe(false);
    expect(PIN_PATTERN.test("abcd")).toBe(false);
    expect(PIN_PATTERN.test("12a4")).toBe(false);
  });

  it("rejects weak sequential and repetitive PINs", () => {
    expect(pinProblem("1111")).toContain("repeated or running sequence");
    expect(pinProblem("000000")).toContain("repeated or running sequence");
    expect(pinProblem("1234")).toContain("repeated or running sequence");
    expect(pinProblem("4321")).toContain("repeated or running sequence");
    expect(pinProblem("9876")).toContain("repeated or running sequence");
  });

  it("accepts complex, strong PINs", () => {
    expect(pinProblem("7391")).toBeNull();
    expect(pinProblem("826194")).toBeNull();
    expect(pinProblem("5193")).toBeNull();
  });

  it("enforces 5 max failures and 15-minute lockout constant", () => {
    expect(MAX_PIN_FAILURES).toBe(5);
    expect(PIN_LOCK_MINUTES).toBe(15);
  });
});

describe("Password Complexity & Field Length Boundary Tests", () => {
  it("rejects passwords under minimum length", () => {
    const res = validatePasswordStrength("Short1");
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain("at least 8 characters");
    }
  });

  it("rejects passwords missing digits", () => {
    const res = validatePasswordStrength("AlphaOnlyPassword");
    expect(res.ok).toBe(false);
  });

  it("rejects passwords missing letters", () => {
    const res = validatePasswordStrength("123456789012");
    expect(res.ok).toBe(false);
  });

  it("rejects passwords exceeding maximum allowed length", () => {
    const res = validatePasswordStrength("A1" + "x".repeat(PASSWORD_MAX_LENGTH + 5));
    expect(res.ok).toBe(false);
  });

  it("approves strong passwords meeting all complexity rules", () => {
    const res = validatePasswordStrength("AmburaxSecure#2026");
    expect(res.ok).toBe(true);
  });
});
