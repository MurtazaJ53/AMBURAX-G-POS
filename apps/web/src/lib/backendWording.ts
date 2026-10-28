/**
 * The product never names the accounting system it syncs to (owner decision 2026-10-20): on
 * screen it is "accounting" (owner decision 2026-10-28). Stored sync errors keep their full
 * technical text for support; this rewrites them only where a person reads them.
 */
export function backendWording(text: string | null | undefined): string {
  if (!text) return "";
  const rewritten = text
    .replace(/Frappe Cloud/g, "accounting hosting")
    .replace(/\bERPNext\b|\bFrappe\b|\bERP\b/g, "accounting")
    .replace(/\bPostgreSQL\b|\bPostgres\b|\bPrisma\b/g, "the database");
  // A replacement that opens the text or a sentence reads as one: capitalise it there.
  return rewritten.replace(/(^|[.!?]\s+)(accounting|the database)/g, (_m, lead: string, word: string) => lead + word[0]!.toUpperCase() + word.slice(1));
}
