import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/identity/password";

// Real bcryptjs at cost 12 is pure JS; under the full parallel suite a single hash can
// exceed the 15s global timeout, so the bcrypt-backed suites get more headroom.
describe("password hashing", { timeout: 60_000 }, () => {
  it("verifies a correct password against its hash", async () => {
    const hash = await hashPassword("Passw0rd!123");
    await expect(verifyPassword("Passw0rd!123", hash)).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("Passw0rd!123");
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("never stores the plaintext password in the hash", async () => {
    const hash = await hashPassword("Passw0rd!123");
    expect(hash).not.toContain("Passw0rd!123");
  });
});
