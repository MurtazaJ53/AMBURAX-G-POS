import { describe, expect, it } from "vitest";
import { isWithinCooldown } from "@/server/identity/passwordReset";

describe("isWithinCooldown", () => {
  it("is within cooldown right after sending", () => {
    expect(isWithinCooldown(new Date(), 60)).toBe(true);
  });

  it("is within cooldown a moment before the window elapses", () => {
    const lastSentAt = new Date(Date.now() - 59_000);
    expect(isWithinCooldown(lastSentAt, 60)).toBe(true);
  });

  it("is not within cooldown once the window has elapsed", () => {
    const lastSentAt = new Date(Date.now() - 61_000);
    expect(isWithinCooldown(lastSentAt, 60)).toBe(false);
  });
});
