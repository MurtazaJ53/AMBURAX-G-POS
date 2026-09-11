import { describe, expect, it } from "vitest";
import { generateOtpCode, hashOtpCode, verifyOtpCode } from "@/server/identity/otp";

describe("OTP codes", () => {
  it("generates a code of the configured length, zero-padded", () => {
    const code = generateOtpCode();
    expect(code).toMatch(/^\d{6}$/);
  });

  it("verifies a correct code against its hash", async () => {
    const code = generateOtpCode();
    const hash = await hashOtpCode(code);
    await expect(verifyOtpCode(code, hash)).resolves.toBe(true);
  });

  it("rejects an incorrect code", async () => {
    const hash = await hashOtpCode("123456");
    await expect(verifyOtpCode("654321", hash)).resolves.toBe(false);
  });

  it("never stores the plaintext code in the hash", async () => {
    const code = generateOtpCode();
    const hash = await hashOtpCode(code);
    expect(hash).not.toContain(code);
  });
});
