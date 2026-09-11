import { describe, expect, it } from "vitest";
import { validatePasswordStrength, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from "@/server/identity/passwordPolicy";

describe("validatePasswordStrength", () => {
  it("rejects a password shorter than the minimum", () => {
    const result = validatePasswordStrength("a1".repeat(2));
    expect(result.ok).toBe(false);
  });

  it("accepts a password exactly at the minimum length with a letter and a number", () => {
    const password = "a1".repeat(PASSWORD_MIN_LENGTH / 2);
    expect(password.length).toBe(PASSWORD_MIN_LENGTH);
    expect(validatePasswordStrength(password)).toEqual({ ok: true });
  });

  it("rejects a password with no digit", () => {
    expect(validatePasswordStrength("abcdefgh").ok).toBe(false);
  });

  it("rejects a password with no letter", () => {
    expect(validatePasswordStrength("12345678").ok).toBe(false);
  });

  it("rejects a password longer than the maximum", () => {
    const tooLong = "a1".repeat(Math.ceil((PASSWORD_MAX_LENGTH + 2) / 2));
    expect(validatePasswordStrength(tooLong).ok).toBe(false);
  });

  it("accepts a normal strong password", () => {
    expect(validatePasswordStrength("Correct-Horse-9").ok).toBe(true);
  });
});
