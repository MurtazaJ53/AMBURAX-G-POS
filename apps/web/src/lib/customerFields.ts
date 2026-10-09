/**
 * The rules for a customer's name, mobile number, e-mail and GSTIN — one copy, used by the till
 * as the cashier types and by the server before anything is stored, so the two can never
 * disagree about what is valid.
 *
 * Pure functions, no imports: safe in a client component and in a route handler alike.
 */

export type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * One mobile number, one spelling. The table holds numbers typed every way a counter types
 * them — "98765 43210", "+91 98765-43210", "098765 43210" — and a unique index on the raw
 * string cannot see that those are the same person. Everything new is stored as E.164
 * ("+919876543210"); `phoneLookupVariants` finds the older spellings.
 *
 * Indian mobiles are the expected case (10 digits, starting 6–9). A number written with a
 * leading "+" and another country code is accepted as international, 8–15 digits.
 */
export function normalizePhone(raw: string): FieldResult<string> {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, error: "Enter the customer's mobile number." };
  if (!/^[+0-9 ()-]+$/.test(trimmed)) {
    return { ok: false, error: "A mobile number can only contain digits." };
  }
  const digits = trimmed.replace(/\D/g, "");

  let national: string | null = null;
  if (digits.length === 10) national = digits;
  else if (digits.length === 11 && digits.startsWith("0")) national = digits.slice(1);
  else if (digits.length === 12 && digits.startsWith("91")) national = digits.slice(2);

  if (national !== null) {
    if (!/^[6-9]/.test(national)) {
      return { ok: false, error: "An Indian mobile number starts with 6, 7, 8 or 9." };
    }
    return { ok: true, value: `+91${national}` };
  }

  if (trimmed.startsWith("+") && !digits.startsWith("91") && digits.length >= 8 && digits.length <= 15) {
    return { ok: true, value: `+${digits}` };
  }
  return { ok: false, error: "Enter a 10-digit mobile number." };
}

/** Every spelling an existing row may hold for this number, for lookups and duplicate checks. */
export function phoneLookupVariants(e164: string): string[] {
  if (!e164.startsWith("+91")) return [e164];
  const national = e164.slice(3);
  return [e164, national, `91${national}`, `0${national}`];
}

/** Display form: "+91 98765 43210". Unknown shapes are shown as stored. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  const national =
    digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits.length === 10 ? digits : null;
  return national ? `+91 ${national.slice(0, 5)} ${national.slice(5)}` : phone;
}

/**
 * A person's or a business's name: letters (any script), spaces and the punctuation names
 * actually use. Digits are refused — a phone number typed into the name box is the most common
 * counter mistake there is.
 */
export function normalizeName(raw: string): FieldResult<string> {
  const value = raw.trim().replace(/\s+/g, " ");
  if (value.length < 2) return { ok: false, error: "Enter the customer's name (at least 2 letters)." };
  if (value.length > 80) return { ok: false, error: "Keep the name under 80 characters." };
  if (/\d/.test(value)) return { ok: false, error: "A name cannot contain numbers." };
  if (!/^[\p{L}\p{M} .'&()-]+$/u.test(value)) {
    return { ok: false, error: "Use letters, spaces and . ' - & only." };
  }
  return { ok: true, value };
}

/** Optional. Empty means "none"; anything typed must look like an address. */
export function normalizeEmail(raw: string | null | undefined): FieldResult<string | null> {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "") return { ok: true, value: null };
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
    return { ok: false, error: "Enter a valid e-mail address, or leave it empty." };
  }
  return { ok: true, value };
}

/** The documented 15-character layout — a shape check, not a government verification. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

/** Optional. Stored uppercase without spaces so one number has one spelling. */
export function normalizeGstin(raw: string | null | undefined): FieldResult<string | null> {
  const value = (raw ?? "").toUpperCase().replace(/\s+/g, "");
  if (value === "") return { ok: true, value: null };
  if (!GSTIN_PATTERN.test(value)) {
    return { ok: false, error: "A GSTIN is 15 characters, like 27ABCDE1234F1Z5." };
  }
  return { ok: true, value };
}
