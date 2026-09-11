import { randomBytes } from "node:crypto";
import { hashOpaqueToken } from "@/server/identity/token";

/**
 * Shared POS-device primitives. Imported by `posDeviceSetup.ts` (A9's creation path) and
 * `posDeviceActivation.ts` (the device's claim path) so status derivation and pairing-code
 * handling exist exactly once — the same discipline A11 applied to the invitation lookup.
 */

/**
 * Derived, never stored. `createdAt` and `activatedAt` are deliberately different facts:
 * PENDING_ACTIVATION means the owner configured a terminal and nothing has claimed it yet.
 * The A9 UI must not describe that state as a working POS.
 */
export type PosDeviceStatus =
  | "PENDING_ACTIVATION"
  | "PAIRING_EXPIRED"
  | "ACTIVE"
  | "DISABLED";

export function derivePosDeviceStatus(device: {
  activatedAt: Date | null;
  disabledAt: Date | null;
  pairingExpiresAt: Date | null;
}): PosDeviceStatus {
  if (device.disabledAt) return "DISABLED";
  if (device.activatedAt) return "ACTIVE";
  if (device.pairingExpiresAt && device.pairingExpiresAt.getTime() <= Date.now()) {
    return "PAIRING_EXPIRED";
  }
  return "PENDING_ACTIVATION";
}

// Crockford base32: no I/L/O/U, so a code read off a screen and typed into a terminal
// can't be mis-transcribed into a different valid code.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * One-time pairing code. 20 random bytes rendered one base32 character each — long,
 * because this is the only thing standing between "someone glimpsed the setup screen"
 * and a terminal that can transact. Uses `randomBytes` (CSPRNG), never `Math.random`.
 * 32 symbols x 20 characters is ~100 bits of entropy, far past brute force even before
 * the short TTL and the rate limiter. Grouped for display only; `normalizePairingCode`
 * strips the grouping before hashing, so what the user types and what was issued agree.
 */
export function generatePairingCode(): string {
  const bytes = randomBytes(20);
  let out = "";
  for (const byte of bytes) {
    // Modulo over 256 with a 32-symbol alphabet divides evenly (256 = 32 * 8), so this
    // introduces no bias.
    out += ALPHABET[byte % ALPHABET.length];
  }
  return out;
}

/** Case- and separator-insensitive, so a hand-typed code matches what was issued. */
export function normalizePairingCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

export function hashPairingCode(code: string): string {
  return hashOpaqueToken(normalizePairingCode(code));
}

/** Display grouping only — never the stored or hashed form. */
export function formatPairingCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? [code]).join("-");
}
