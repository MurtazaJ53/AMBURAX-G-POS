import type { SalesFilters } from "./saleQueries";

/**
 * The Sales screen's URL filters, parsed in one place so the screen and the CSV export can never
 * disagree about what "the current filters" means.
 *
 * The screen is lenient: an unrecognised value is dropped and the list widens. The export is
 * strict: an unrecognised value is refused, because silently widening a file someone takes away
 * would export rows they did not ask for.
 */

export const SALES_PAYMENT_METHODS = ["CASH", "UPI", "CARD"] as const;
type PaymentMethod = (typeof SALES_PAYMENT_METHODS)[number];
const SALES_STATUSES = ["COMPLETED", "VOIDED"] as const;
type SaleStatusFilter = (typeof SALES_STATUSES)[number];
export const SALES_QUERY_MAX_LENGTH = 100;

export function parseMethod(value: string | undefined | null): PaymentMethod | undefined {
  return SALES_PAYMENT_METHODS.includes(value as PaymentMethod) ? (value as PaymentMethod) : undefined;
}

export function parseStatus(value: string | undefined | null): SaleStatusFilter | undefined {
  return SALES_STATUSES.includes(value as SaleStatusFilter) ? (value as SaleStatusFilter) : undefined;
}

/** A calendar day in IST. `endOfDay` gives the exclusive start of the next day. */
export function parseDate(value: string | undefined | null, endOfDay = false): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const base = Date.UTC(y!, m! - 1, d!, 0, 0, 0) - IST_OFFSET_MS;
  return new Date(endOfDay ? base + 24 * 60 * 60 * 1000 : base);
}

/** True for a real calendar day (rejects 2026-02-31, which Date.UTC would roll over). */
function isRealDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(y!, m! - 1, d!));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m! - 1 && probe.getUTCDate() === d;
}

export type StrictSalesFilters =
  | { ok: true; filters: SalesFilters }
  | { ok: false; field: "q" | "method" | "status" | "from" | "to" | "range"; reason: string };

/** Strict parse for the export: present-but-invalid values are errors, never ignored. */
export function parseSalesFiltersStrict(get: (name: string) => string | null): StrictSalesFilters {
  const raw = (name: string) => {
    const v = get(name);
    return v === null || v.trim() === "" ? undefined : v.trim();
  };

  const q = raw("q");
  if (q !== undefined && q.length > SALES_QUERY_MAX_LENGTH) {
    return { ok: false, field: "q", reason: `Search is limited to ${SALES_QUERY_MAX_LENGTH} characters.` };
  }

  const methodRaw = raw("method");
  const method = parseMethod(methodRaw);
  if (methodRaw !== undefined && !method) return { ok: false, field: "method", reason: "Unknown payment method." };

  const statusRaw = raw("status");
  const status = parseStatus(statusRaw);
  if (statusRaw !== undefined && !status) return { ok: false, field: "status", reason: "Unknown status." };

  const fromRaw = raw("from");
  if (fromRaw !== undefined && !isRealDay(fromRaw)) return { ok: false, field: "from", reason: "From date must be a valid YYYY-MM-DD date." };
  const from = parseDate(fromRaw);

  const toRaw = raw("to");
  if (toRaw !== undefined && !isRealDay(toRaw)) return { ok: false, field: "to", reason: "To date must be a valid YYYY-MM-DD date." };
  const to = parseDate(toRaw, true);

  if (from && to && from >= to) return { ok: false, field: "range", reason: "From date must not be after the to date." };

  return { ok: true, filters: { query: q, method, status, from, to } };
}
