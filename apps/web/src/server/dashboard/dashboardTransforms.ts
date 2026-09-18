/**
 * Dashboard shaping — the parts that are arithmetic rather than data access.
 *
 * Kept apart from `dashboardQueries` so every transformation on this screen can be tested
 * without a database. The rule these functions exist to enforce is the one the queries
 * already follow: a figure is either derived from rows the system holds, or it is `null`
 * and the widget says so. Nothing here invents a denominator, a comparison period or a
 * bucket that had no rows behind it.
 *
 * Time is the subtle part. Every timestamp the database returns is a UTC instant, and a
 * trading day in Bengaluru begins 5.5 hours before UTC midnight. So no function here ever
 * calls `getHours()` or `getDate()` — bucketing by those would put the first five and a half
 * hours of every Indian evening into the following day's column. Everything goes through
 * `Intl` with an explicit timezone.
 */

/** The store's trading timezone. Fixed while stores have no timezone column of their own. */
export const STORE_TIME_ZONE = "Asia/Kolkata";

/** India has never observed DST, so the offset is a constant rather than a lookup. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/**
 * Midnight in the store's timezone, as the UTC instant it corresponds to.
 *
 * Shared by the queries (which use it as a `gte` bound) and by the bucketing below (which
 * uses it as the origin of the hour columns), so a figure and the axis it is plotted on
 * cannot disagree about when the day started.
 */
export function startOfStoreDay(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: STORE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const [year, month, day] = parts.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!, 0, 0, 0, 0) - IST_OFFSET_MS);
}

/** The store day `days` before the given one. Negative values move forward. */
export function shiftStoreDay(dayStart: Date, days: number): Date {
  return new Date(dayStart.getTime() - days * DAY_MS);
}

/**
 * Movement against a comparison period.
 *
 * Null — not zero, and not a large positive — when the previous period has nothing in it.
 * "Up 100%" from a day the shop was shut is a sentence about arithmetic, not about trade,
 * and a merchant reading it as trade would be misled.
 */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export interface SaleInstant {
  completedAt: Date;
  totalMinor: number;
}

export interface TrendPoint {
  /** Axis label already rendered in store time — "14:00" for hours, "12 Sep" for days. */
  label: string;
  /** Bucket start as a UTC instant, kept so a caller can re-format without re-bucketing. */
  startsAt: Date;
  salesMinor: number;
  billCount: number;
}

/** Hour of day in the store's timezone, 0-23. Never the UTC hour. */
export function storeHour(date: Date): number {
  const value = new Intl.DateTimeFormat("en-GB", {
    timeZone: STORE_TIME_ZONE,
    hour: "2-digit",
    hour12: false,
  }).format(date);
  // "24" is how some ICU versions spell midnight under hour12:false.
  return Number(value) % 24;
}

/** Calendar date in the store's timezone as YYYY-MM-DD. Never the UTC date. */
export function storeDateKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: STORE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Sales bucketed into the hours of one trading day.
 *
 * Every hour in the range is present, including the empty ones: a trend that skipped quiet
 * hours would compress the afternoon and imply trade that did not happen. Sales outside the
 * day are dropped rather than folded into the nearest column, because folding them would
 * credit an hour that did not earn them.
 */
export function bucketByHour(
  sales: SaleInstant[],
  dayStart: Date,
  options: { fromHour?: number; toHour?: number } = {},
): TrendPoint[] {
  const fromHour = options.fromHour ?? 0;
  const toHour = options.toHour ?? 23;

  const points: TrendPoint[] = [];
  const byHour = new Map<number, TrendPoint>();

  for (let hour = fromHour; hour <= toHour; hour += 1) {
    const point: TrendPoint = {
      label: `${String(hour).padStart(2, "0")}:00`,
      startsAt: new Date(dayStart.getTime() + hour * 3_600_000),
      salesMinor: 0,
      billCount: 0,
    };
    points.push(point);
    byHour.set(hour, point);
  }

  const dayKey = storeDateKey(dayStart);
  for (const sale of sales) {
    // The day check matters: an hour number alone would let yesterday's 14:00 land in
    // today's 14:00 column if a caller passed a wider window than it meant to.
    if (storeDateKey(sale.completedAt) !== dayKey) continue;
    const point = byHour.get(storeHour(sale.completedAt));
    if (!point) continue;
    point.salesMinor += sale.totalMinor;
    point.billCount += 1;
  }

  return points;
}

/**
 * Sales bucketed into whole trading days, oldest first.
 *
 * `days` counts back from and includes the day `lastDayStart` begins, so "7 days" is the
 * last seven trading days — which is what a shopkeeper means by it — rather than a rolling
 * 168 hours ending mid-afternoon.
 */
export function bucketByDay(sales: SaleInstant[], lastDayStart: Date, days: number): TrendPoint[] {
  const points: TrendPoint[] = [];
  const byKey = new Map<string, TrendPoint>();

  const labeller = new Intl.DateTimeFormat("en-GB", {
    timeZone: STORE_TIME_ZONE,
    day: "numeric",
    month: "short",
  });

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const startsAt = new Date(lastDayStart.getTime() - offset * DAY_MS);
    const point: TrendPoint = {
      label: labeller.format(startsAt),
      startsAt,
      salesMinor: 0,
      billCount: 0,
    };
    points.push(point);
    // Keyed by the store-local date rather than by arithmetic on the instant, so a bucket
    // can only collect sales the store itself would call that day.
    byKey.set(storeDateKey(startsAt), point);
  }

  for (const sale of sales) {
    const point = byKey.get(storeDateKey(sale.completedAt));
    if (!point) continue;
    point.salesMinor += sale.totalMinor;
    point.billCount += 1;
  }

  return points;
}

export interface ShareRow {
  key: string;
  label: string;
  amountMinor: number;
  /** Share of the total, 0-100, one decimal. Null when the rows sum to zero. */
  sharePct: number | null;
}

/**
 * Rank named amounts and give each its share of their total.
 *
 * The denominator is the sum of the rows passed in, never a figure from elsewhere on the
 * screen: percentages taken against total sales, while the rows only cover categorised
 * products, would silently not add up to 100 and nobody could see why.
 */
export function toShares(
  rows: { key: string; label: string; amountMinor: number }[],
  options: { limit?: number } = {},
): { rows: ShareRow[]; totalMinor: number } {
  const totalMinor = rows.reduce((sum, row) => sum + row.amountMinor, 0);

  const ranked = [...rows]
    .sort((a, b) => b.amountMinor - a.amountMinor || a.label.localeCompare(b.label))
    .slice(0, options.limit ?? rows.length)
    .map((row) => ({
      key: row.key,
      label: row.label,
      amountMinor: row.amountMinor,
      sharePct: totalMinor > 0 ? Math.round((row.amountMinor / totalMinor) * 1000) / 10 : null,
    }));

  return { rows: ranked, totalMinor };
}

/** Operator-facing name for a stored payment method. Unknown values pass through as-is. */
export function paymentMethodLabel(method: string): string {
  switch (method) {
    case "CASH":
      return "Cash";
    case "UPI":
      return "UPI";
    case "CARD":
      return "Card";
    default:
      return method;
  }
}

/**
 * Colours for the payment donut and the category bars.
 *
 * Indexed rather than keyed by name, so a payment method the schema gains later still gets
 * a colour instead of rendering invisible. This is the only place the dashboard names a
 * hue; every other colour on the screen comes from a semantic token.
 */
export const SERIES_COLOURS = ["#2563eb", "#8b5cf6", "#10b981", "#f59e0b", "#94a3b8"] as const;

export function seriesColour(index: number): string {
  return SERIES_COLOURS[index % SERIES_COLOURS.length]!;
}

/** Clock time in store time, for a bill list read at the counter. */
export function formatStoreTime(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: STORE_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** The trading day, spelled out for the page header. */
export function formatTradingDay(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: STORE_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/**
 * Money, abbreviated for a chart axis.
 *
 * Lakh and crore rather than K and M: the figures are rupees, read by someone who thinks in
 * lakhs, and an axis labelled "4.8M" would need converting in the reader's head.
 */
export function formatAxisMoney(minor: number): string {
  const major = Math.round(minor / 100);
  if (Math.abs(major) >= 10_000_000) return `₹${(major / 10_000_000).toFixed(1)}Cr`;
  if (Math.abs(major) >= 100_000) return `₹${(major / 100_000).toFixed(1)}L`;
  if (Math.abs(major) >= 1_000) return `₹${Math.round(major / 1_000)}K`;
  return `₹${major}`;
}

/** Time-of-day greeting in store time. */
export function greetingFor(now: Date = new Date()): string {
  const hour = storeHour(now);
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** Two initials for an avatar. Never more, and never an empty box. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

export type TrendRange = "today" | "yesterday" | "7d" | "30d";

export const TREND_RANGES: { id: TrendRange; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
];

export function isTrendRange(value: unknown): value is TrendRange {
  return value === "today" || value === "yesterday" || value === "7d" || value === "30d";
}

/** How many whole store days a range spans. `today` and `yesterday` are single days. */
export function trendRangeDays(range: TrendRange): number {
  switch (range) {
    case "7d":
      return 7;
    case "30d":
      return 30;
    default:
      return 1;
  }
}
