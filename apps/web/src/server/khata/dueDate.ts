/**
 * Deterministic invoice due date and effective terms calculation.
 *
 * Rules:
 * 1. Positive customer terms: calendar days added to the invoice business date in the store's timezone.
 * 2. Zero customer terms: invoice business date (due immediately on invoice date).
 * 3. NULL customer terms: inherit company default (company.defaultPaymentTermsDays), or 0 days if not set / <= 0.
 *
 * Both effectiveTermsDaysSnapshot and dueDateSnapshot are persisted on the Sale / invoice.
 *
 * Note on due-date arithmetic:
 * Calendar days are added across year/month/day boundaries in the store's business timezone
 * (established store convention: "Asia/Kolkata", fixed offset +05:30 with no DST transitions).
 *
 * Writer connection gate:
 * When on-account checkout is enabled, this function calculates the snapshots. Currently,
 * on-account checkout remains fail-closed in `saleService.ts:302-310`, keeping the due-date
 * snapshot writer unconnected from live checkout mutations.
 */

export interface CalculateDueDateParams {
  completedAt: Date;
  customerPaymentTermsDays?: number | null;
  companyDefaultTermsDays?: number | null;
  timeZone?: string;
}

export interface DueDateResult {
  effectiveTermsDays: number;
  dueDate: Date;
}

/** Default business timezone for stores in the repository */
export const DEFAULT_BUSINESS_TIMEZONE = "Asia/Kolkata";

/**
 * Adds integer calendar days to a Date based on civil calendar representation
 * in the specified timezone (handles month lengths, leap years, etc.).
 */
export function addCalendarDaysInTimeZone(date: Date, days: number, timeZone = DEFAULT_BUSINESS_TIMEZONE): Date {
  if (days <= 0) {
    return new Date(date.getTime());
  }

  // Format parts to get exact year, month, day, hour, minute, second in the target timezone
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const partMap: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") {
      partMap[p.type] = parseInt(p.value, 10);
    }
  }

  // Construct UTC representation of the wall-clock calendar date
  const year = partMap.year ?? date.getUTCFullYear();
  const month = (partMap.month ?? (date.getUTCMonth() + 1)) - 1;
  const day = partMap.day ?? date.getUTCDate();
  const hour = partMap.hour === 24 ? 0 : (partMap.hour ?? date.getUTCHours());
  const minute = partMap.minute ?? date.getUTCMinutes();
  const second = partMap.second ?? date.getUTCSeconds();

  // Date.UTC safely handles calendar day addition across month and leap-year boundaries
  const targetUtcMs = Date.UTC(year, month, day + days, hour, minute, second, date.getMilliseconds());

  // Determine timezone offset in ms between targetUtc and local wall clock in timeZone
  const testDate = new Date(targetUtcMs);
  const testParts = formatter.formatToParts(testDate);
  const testMap: Record<string, number> = {};
  for (const p of testParts) {
    if (p.type !== "literal") {
      testMap[p.type] = parseInt(p.value, 10);
    }
  }

  const testYear = testMap.year ?? testDate.getUTCFullYear();
  const testMonth = (testMap.month ?? (testDate.getUTCMonth() + 1)) - 1;
  const testDay = testMap.day ?? testDate.getUTCDate();
  const testHour = testMap.hour === 24 ? 0 : (testMap.hour ?? testDate.getUTCHours());
  const testMin = testMap.minute ?? testDate.getUTCMinutes();
  const testSec = testMap.second ?? testDate.getUTCSeconds();

  const testWallMs = Date.UTC(testYear, testMonth, testDay, testHour, testMin, testSec, testDate.getMilliseconds());
  const tzOffsetMs = testWallMs - targetUtcMs;

  return new Date(targetUtcMs - tzOffsetMs);
}

export function calculateInvoiceDueDate(params: CalculateDueDateParams): DueDateResult {
  const { completedAt, customerPaymentTermsDays, companyDefaultTermsDays, timeZone = DEFAULT_BUSINESS_TIMEZONE } = params;

  let effectiveTermsDays: number;

  if (customerPaymentTermsDays !== undefined && customerPaymentTermsDays !== null) {
    effectiveTermsDays = Math.max(0, customerPaymentTermsDays);
  } else {
    effectiveTermsDays = Math.max(0, companyDefaultTermsDays ?? 0);
  }

  const dueDate = addCalendarDaysInTimeZone(completedAt, effectiveTermsDays, timeZone);

  return {
    effectiveTermsDays,
    dueDate,
  };
}

/**
 * Compare function for FIFO repayment allocation against outstanding credit sales.
 * Order:
 * 1. dueDateSnapshot ASC (nulls last)
 * 2. completedAt ASC
 * 3. id ASC (stable deterministic tie-breaker)
 */
export function compareSalesForFifoRepayment(
  a: { id: string; dueDateSnapshot: Date | null; completedAt: Date },
  b: { id: string; dueDateSnapshot: Date | null; completedAt: Date }
): number {
  if (a.dueDateSnapshot && b.dueDateSnapshot) {
    const diff = a.dueDateSnapshot.getTime() - b.dueDateSnapshot.getTime();
    if (diff !== 0) return diff;
  } else if (a.dueDateSnapshot && !b.dueDateSnapshot) {
    return -1;
  } else if (!a.dueDateSnapshot && b.dueDateSnapshot) {
    return 1;
  }

  const completedDiff = a.completedAt.getTime() - b.completedAt.getTime();
  if (completedDiff !== 0) return completedDiff;

  return a.id.localeCompare(b.id);
}
