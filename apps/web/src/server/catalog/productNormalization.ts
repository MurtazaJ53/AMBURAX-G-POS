/**
 * Shared product key normalizer.
 *
 * Rules:
 *  - Lowercase
 *  - Trim leading and trailing whitespace
 *  - Remove all spaces, dashes, and punctuation characters (keep only [a-z0-9])
 *
 * This exact transformation is mirrored in PostgreSQL as an IMMUTABLE function:
 *   CREATE OR REPLACE FUNCTION normalize_product_key(raw_text text)
 *   RETURNS text AS $$
 *     SELECT regexp_replace(lower(trim(COALESCE(raw_text, ''))), '[^a-z0-9]', '', 'g');
 *   $$ LANGUAGE sql IMMUTABLE;
 */
export function normalizeProductKey(rawText: string | null | undefined): string {
  if (!rawText) return "";
  return rawText
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Human-readable display normalizer (collapses consecutive whitespace, trims).
 */
export function normalizeDisplayName(rawText: string | null | undefined): string {
  if (!rawText) return "";
  return rawText.trim().replace(/\s+/g, " ");
}

/**
 * Normalizes a brand value for storage and matching.
 * Treats 'all', empty string, and whitespace as null (no brand).
 */
export function normalizeBrandValue(brand: string | null | undefined): string | null {
  if (!brand) return null;
  const clean = brand.trim().replace(/\s+/g, " ");
  if (!clean || clean.toLowerCase() === "all") return null;
  return clean;
}

