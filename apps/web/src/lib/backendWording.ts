/**
 * The product never names the accounting system it syncs to (owner decision 2026-10-20): on
 * screen it is "Backend". Stored sync errors keep their full technical text for support; this
 * rewrites them only where a person reads them.
 */
export function backendWording(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/Frappe Cloud/g, "Backend hosting")
    .replace(/\bERPNext\b|\bFrappe\b/g, "Backend")
    .replace(/\bERP\b/g, "Backend")
    .replace(/\bPostgreSQL\b|\bPostgres\b|\bPrisma\b/g, "Backend");
}
