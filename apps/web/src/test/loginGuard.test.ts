import { describe, expect, it } from "vitest";
import { isAccountLocked } from "@/server/identity/loginGuard";

describe("isAccountLocked", () => {
  it("is not locked when lockedUntil is null", () => {
    expect(isAccountLocked(null)).toBe(false);
  });

  it("is locked when lockedUntil is in the future", () => {
    expect(isAccountLocked(new Date(Date.now() + 60_000))).toBe(true);
  });

  it("is not locked once lockedUntil is in the past", () => {
    expect(isAccountLocked(new Date(Date.now() - 60_000))).toBe(false);
  });
});
