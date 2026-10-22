/**
 * Udhar credit mode rules, kept pure so every caller resolves a mode the same way.
 *
 * - BLOCKED: no udhar. UNLIMITED: udhar without a numeric cap. LIMITED: udhar up to a positive limit.
 * - Anything missing or invalid resolves to BLOCKED. A null limit never means unlimited.
 * - LIMITED needs a positive safe-integer limit in minor units; BLOCKED and UNLIMITED carry none.
 *
 * The database enforces the same mode/limit pairing with CHECK constraints; this module is the
 * application-side mirror, so a bad row or bad input degrades to BLOCKED instead of throwing.
 */

export const CREDIT_MODES = ["BLOCKED", "UNLIMITED", "LIMITED"] as const;
export type CreditModeValue = (typeof CREDIT_MODES)[number];
/** Prisma `Int` maps to PostgreSQL's signed 32-bit integer. */
export const MAX_CREDIT_MODE_LIMIT_MINOR = 2_147_483_647;

export interface CreditModeConfig {
  mode: CreditModeValue;
  /** Positive minor units when LIMITED; null otherwise. */
  limitMinor: number | null;
}

export const BLOCKED_CONFIG: CreditModeConfig = Object.freeze({ mode: "BLOCKED", limitMinor: null });

export type CreditModeValidation =
  | { ok: true; config: CreditModeConfig }
  | { ok: false; reason: string };

function isCreditMode(value: unknown): value is CreditModeValue {
  return typeof value === "string" && (CREDIT_MODES as readonly string[]).includes(value);
}

/** Strict check for input that is about to be stored (e.g. an owner setting a mode). */
export function validateCreditMode(mode: unknown, limitMinor: unknown): CreditModeValidation {
  if (!isCreditMode(mode)) return { ok: false, reason: "Credit mode must be BLOCKED, UNLIMITED or LIMITED." };
  if (mode === "LIMITED") {
    if (typeof limitMinor !== "number" || !Number.isSafeInteger(limitMinor) || limitMinor <= 0 || limitMinor > MAX_CREDIT_MODE_LIMIT_MINOR) {
      return { ok: false, reason: `A LIMITED credit mode needs a positive whole-number limit in minor units no greater than ${MAX_CREDIT_MODE_LIMIT_MINOR}.` };
    }
    return { ok: true, config: { mode, limitMinor } };
  }
  if (limitMinor !== null && limitMinor !== undefined) {
    return { ok: false, reason: `A ${mode} credit mode cannot carry a limit.` };
  }
  return { ok: true, config: { mode, limitMinor: null } };
}

/** Lenient read of stored configuration: anything that does not validate is BLOCKED. */
export function resolveCreditMode(stored: { mode?: unknown; limitMinor?: unknown } | null | undefined): CreditModeConfig {
  if (!stored) return BLOCKED_CONFIG;
  const result = validateCreditMode(stored.mode, stored.limitMinor ?? null);
  return result.ok ? result.config : BLOCKED_CONFIG;
}
