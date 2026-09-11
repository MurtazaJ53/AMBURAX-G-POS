/**
 * The only place a password's strength is ever judged. Nothing enforced this before A4 —
 * A1 only compares against an existing hash, it never creates one. Follows NIST 800-63B's
 * length-over-cleverness guidance rather than demanding special characters: a long
 * passphrase should pass, "P@ss1" should not.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

export type PasswordStrengthResult = { ok: true } | { ok: false; reason: string };

export function validatePasswordStrength(password: string): PasswordStrengthResult {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, reason: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, reason: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.` };
  }
  if (!/[a-zA-Z]/.test(password)) {
    return { ok: false, reason: "Password must include at least one letter." };
  }
  if (!/[0-9]/.test(password)) {
    return { ok: false, reason: "Password must include at least one number." };
  }
  return { ok: true };
}
