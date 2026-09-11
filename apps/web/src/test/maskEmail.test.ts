import { describe, expect, it } from "vitest";
import { maskEmail } from "@/server/identity/mfaChallenge";

describe("maskEmail", () => {
  it("masks the middle of a normal local part", () => {
    expect(maskEmail("owner@demo.amburax.test")).toBe("ow***@demo.amburax.test");
  });

  it("never reveals the full local part", () => {
    const masked = maskEmail("jd@example.com");
    expect(masked).not.toContain("jd@example.com".split("@")[0]);
  });

  it("still returns something usable for a very short local part", () => {
    const masked = maskEmail("a@example.com");
    expect(masked.endsWith("@example.com")).toBe(true);
  });
});
