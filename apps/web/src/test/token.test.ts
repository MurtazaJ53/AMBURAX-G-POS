import { describe, expect, it } from "vitest";
import { generateOpaqueToken, hashOpaqueToken } from "@/server/identity/token";

describe("opaque tokens", () => {
  it("generates high-entropy, unique tokens", () => {
    const a = generateOpaqueToken();
    const b = generateOpaqueToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/); // 32 bytes, hex-encoded
  });

  it("hashes deterministically so a token can be looked up by its hash", () => {
    const token = generateOpaqueToken();
    expect(hashOpaqueToken(token)).toBe(hashOpaqueToken(token));
  });

  it("never stores the plaintext token in its hash", () => {
    const token = generateOpaqueToken();
    const hash = hashOpaqueToken(token);
    expect(hash).not.toBe(token);
    expect(hash).not.toContain(token);
  });

  it("produces different hashes for different tokens", () => {
    const a = hashOpaqueToken(generateOpaqueToken());
    const b = hashOpaqueToken(generateOpaqueToken());
    expect(a).not.toBe(b);
  });
});
