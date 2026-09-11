import { randomBytes, createHash } from "node:crypto";

/**
 * Shared opaque-token shape used by every "hand the client a secret, keep only its
 * hash server-side" flow: sessions, MFA challenges, and now password reset tokens.
 * Extracted because session.ts and mfaChallenge.ts had each hand-rolled the identical
 * sha256 helper; a third copy for reset tokens would have made it three.
 */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
