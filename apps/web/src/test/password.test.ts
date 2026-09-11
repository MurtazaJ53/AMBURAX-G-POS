import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/server/identity/password";

describe("password hashing", () => {
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
