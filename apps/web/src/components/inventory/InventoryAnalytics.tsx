import Link from "next/link";
import {
  type Product,
  type ProductVariant,
  type StockMovement,
  type StockMovementType,
} from "@prisma/client";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { DashboardCardHeader, WidgetEmpty } from "@/components/dashboard/primitives";
import { LOW_STOCK_MAX_UNITS } from "@/server/inventory/inventoryQueries";

/**
 * Stock insights — the analytics band at the foot of /inventory.
 *
 * A server component on purpose: every figure is an aggregate the page already fetched, so
 * nothing here needs state, and the only motion is CSS.
 *
 * The pure helpers below are exported for unit tests. They are the whole of this section's
 * arithmetic, kept out of the JSX so that "do the shares sum to 100" and "is a 00:15 IST sale
 * dated today" are questions a test can answer without rendering anything.
 */

type MovementWithProduct = StockMovement & {
  variant: ProductVariant & {
    product: Product;
  };
};

/** Five, by approved design. The query still returns ten; the movements page shows the rest. */
const RECENT_MOVEMENT_ROWS = 5;

const COUNT = new Intl.NumberFormat("en-IN");

/** Indian digit grouping for every count on this section: 1,678 and, later, 1,00,000. */
export function formatCount(n: number): string {
  return COUNT.format(n);
}

/** A movement's quantity with its direction always visible: "+5", "-1", "0". */
export function formatSignedUnits(delta: number): string {
  return delta > 0 ? `+${COUNT.format(delta)}` : COUNT.format(delta);
}

/**
 * Movement time, pinned to the store's timezone.
 *
 * This used to be `occurredAt.toLocaleDateString('en-GB')`, which formats in whatever timezone
 * the Node process happens to run in. On this machine that is IST, so it looked right; on a
 * UTC host every movement between 00:00 and 05:30 IST would be dated the previous day. The
 * formatter is built once, at module scope, rather than once per row.
 */
const MOVEMENT_TIME = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatMovementTime(d: Date): string {
  return MOVEMENT_TIME.format(d);
}

/**
 * Whole percentages that sum to exactly 100.
 *
 * Rounding each share on its own does not: 33.3 + 33.3 + 33.3 rounds to 99, and a breakdown
 * that claims to be complete must not visibly add up to less. Largest remainder: floor every
 * share, then hand the missing points to the shares that lost the most in flooring. Ties go
 * to the earlier entry, so the result is deterministic. A zero share never gains a point.
 *
 * The remainders are compared as integers (`v*100 mod total`), not as fractions. With
 * fractions, mathematically equal remainders are not equal in floating point: for 66/30/9 of
 * 105, both 30/105 and 9/105 leave exactly .571…, yet `8.571… - 8` compared larger than
 * `28.571… - 28`, so rounding error — not the stated rule — chose who got the point. Counts
 * are integers, so the integer remainder is exact and a true tie is seen as one.
 */
export function wholePercents(values: readonly number[]): number[] {
  const safe = values.map((v) => Math.max(0, v));
  const total = safe.reduce((sum, v) => sum + v, 0);
  if (total <= 0) return safe.map(() => 0);

  const result = safe.map((v) => Math.floor((v * 100) / total));
  let remaining = 100 - result.reduce((sum, v) => sum + v, 0);

  const byRemainder = safe
    .map((v, i) => ({ i, rem: v * 100 - result[i]! * total }))
    .sort((a, b) => b.rem - a.rem || a.i - b.i);

  for (const { i } of byRemainder) {
    if (remaining <= 0) break;
    result[i] = result[i]! + 1;
    remaining -= 1;
  }
  return result;
}

export interface CategoryRow {
  name: string;
  units: number;
  /** Exact share of `totalUnits`, for the bar width. Never scaled. */
  sharePct: number;
  /** Whole-number share for display; across all rows these sum to 100. */
  displayPct: number;
  isOther: boolean;
  /** How many categories "Other" stands for, or null when this is a real category. */
  hiddenCategories: number | null;
}

/**
 * The category breakdown, including the remainder the top-5 cut used to hide.
 *
 * The query returns the five largest categories. Before this, anything beyond them simply
 * vanished — in the demo store 4 categories and 391 units (23.3%) — while the visible
 * percentages, summing to 76.7%, read as a complete breakdown. "Other" now carries
 * `totalUnits - sum(top five)`, measured against the same `totalUnits` denominator, and names
 * how many categories it stands for from `categoryCount` rather than guessing.
 */
export function buildCategoryRows(
  top: readonly { name: string; count: number }[],
  totalUnits: number,
  categoryCount: number,
): CategoryRow[] {
  if (totalUnits <= 0) return [];

  const visible = top.filter((c) => c.count > 0);
  const visibleUnits = visible.reduce((sum, c) => sum + c.count, 0);
  const otherUnits = Math.max(0, totalUnits - visibleUnits);
  const hidden = Math.max(0, categoryCount - visible.length);

  const rows = visible.map((c) => ({
    name: c.name,
    units: c.count,
    isOther: false,
    hiddenCategories: null as number | null,
  }));
  if (otherUnits > 0) {
    rows.push({
      name: "Other",
      units: otherUnits,
      isOther: true,
      // If the counts ever disagree, say "Other" without a number rather than print a wrong one.
      hiddenCategories: hidden > 0 ? hidden : null,
    });
  }

  const display = wholePercents(rows.map((r) => r.units));
  return rows.map((r, i) => ({
    ...r,
    sharePct: (r.units / totalUnits) * 100,
    displayPct: display[i]!,
  }));
}

export type HealthKey = "in" | "low" | "out";

export interface HealthSegment {
  key: HealthKey;
  label: string;
  count: number;
  sharePct: number;
  displayPct: number;
}

export interface StockHealth {
  totalSkus: number;
  segments: HealthSegment[];
  oversold: number;
  /** The stacked bar's accessible name, built from the real counts. */
  summary: string;
}

function skuCount(n: number): string {
  return `${formatCount(n)} ${n === 1 ? "SKU" : "SKUs"}`;
}

/**
 * Stock health by SKU count.
 *
 * Replaces a ring whose arcs were a hardcoded `70% / 20% / 10%`; the demo store's real split
 * is 62.9 / 28.6 / 8.6. Shares are of SKUs, never of units — the old ring centred a unit total
 * over a legend of SKU counts, two different measures in one picture.
 *
 * `oversold` is the subset of `outOfStock` below zero. It is reported as context on that row,
 * never subtracted from it: "out of stock" keeps meaning "cannot be sold", oversold included.
 *
 * Returns null when there are no stock records at all, so the card can say so instead of
 * drawing 0 / 0.
 */
export function buildStockHealth(counts: {
  inStock: number;
  lowStock: number;
  outOfStock: number;
  oversold: number;
}): StockHealth | null {
  const totalSkus = counts.inStock + counts.lowStock + counts.outOfStock;
  if (totalSkus <= 0) return null;

  const raw: { key: HealthKey; label: string; count: number }[] = [
    { key: "in", label: "In Stock", count: counts.inStock },
    { key: "low", label: `Low (≤ ${LOW_STOCK_MAX_UNITS} units)`, count: counts.lowStock },
    { key: "out", label: "Out of Stock", count: counts.outOfStock },
  ];
  const display = wholePercents(raw.map((r) => r.count));
  const segments = raw.map((r, i) => ({
    ...r,
    sharePct: (r.count / totalSkus) * 100,
    displayPct: display[i]!,
  }));

  const summary =
    `Stock status: ${skuCount(counts.inStock)} in stock, ` +
    `${formatCount(counts.lowStock)} low stock, ` +
    `${formatCount(counts.outOfStock)} out of stock` +
    (counts.oversold > 0 ? `, including ${formatCount(counts.oversold)} oversold` : "") +
    ".";

  return { totalSkus, segments, oversold: counts.oversold, summary };
}

/**
 * Display names for every StockMovementType, and only those.
 *
 * Typed as a Record over the enum, so adding a movement type to the schema is a compile error
 * here until it has a label — no raw "STOCK_TAKE" can reach the screen by omission.
 */
export const MOVEMENT_LABELS: Record<StockMovementType, string> = {
  OPENING_BALANCE: "Opening balance",
  RECEIPT: "Receipt",
  SALE: "Sale",
  RETURN: "Return",
  ADJUSTMENT: "Adjustment",
  STOCK_TAKE: "Stock take",
  SUPPLIER_RETURN: "Return to supplier",
  TRANSFER_OUT: "Transfer out",
  TRANSFER_IN: "Transfer in",
};

export type MovementTone = "in" | "out" | "oversold" | "neutral";

/**
 * A movement's treatment, from what it did to the stock rather than from its type.
 *
 * Every SALE used to be red. A sale is the normal business of a shop, and with all 127 demo
 * movements being sales the card was a solid block of alarm. Direction now comes from the sign
 * of the delta, and danger is reserved for the one case the data can actually vouch for: a
 * movement that removed stock and left the balance below zero.
 */
export function movementTone(delta: number, balanceAfter: number): MovementTone {
  if (delta < 0 && balanceAfter < 0) return "oversold";
  if (delta > 0) return "in";
  if (delta < 0) return "out";
  return "neutral";
}

// Text tones mirror StatusPill's emerald/red family at AA-safe weights; the neutral case uses
// the secondary ink token. The token fills (--color-success etc.) are kept for the bar, where
// colour is never the only carrier — every segment is named in the legend beside it.
const TONE: Record<MovementTone, { text: string; Icon: typeof ArrowUpRight }> = {
  in: { text: "text-emerald-700", Icon: ArrowUpRight },
  out: { text: "text-secondary", Icon: ArrowDownRight },
  oversold: { text: "text-red-700", Icon: ArrowDownRight },
  neutral: { text: "text-secondary", Icon: Minus },
};

const SEGMENT_FILL: Record<HealthKey, string> = {
  in: "bg-success",
  low: "bg-warning",
  out: "bg-danger",
};

// The Inventory card shell, kept rather than DashboardCard's rounded-2xl, so this band matches
// the table card above it.
const CARD =
  "flex h-full min-w-0 flex-col rounded-[6px] border border-border bg-background-card p-4 shadow-sm";

/**
 * CSS-only motion, scoped by class name. Category bars grow from zero to their real width;
 * movement rows fade in. Neither repeats, and both are switched off under reduced motion.
 */
const MOTION_CSS = `
@keyframes inv-bar-grow { from { width: 0; } }
@keyframes inv-row-in { from { opacity: 0; } }
.inv-bar { animation: inv-bar-grow 300ms ease-out both; }
.inv-row { animation: inv-row-in 150ms ease-out both; }
@media (prefers-reduced-motion: reduce) { .inv-bar, .inv-row { animation: none; } }
`;

/**
 * The measurement chip beside a card title ("Units", "SKUs").
 *
 * `slate-600`, not the secondary token: on this tinted chip the secondary grey measures
 * 4.34:1, just under AA. One step darker clears it comfortably.
 */
function Qualifier({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-background-subtle px-1.5 py-0.5 text-xs font-medium text-slate-600">
      {children}
    </span>
  );
}

/**
 * Part-local rather than the dashboard's CardLink: same destination and the same focus ring
 * token, but a 32px-tall box instead of a 15px line of text, so it clears the 24x24 target
 * minimum without changing a primitive the dashboard also uses.
 */
function ViewAllLink() {
  return (
    <Link
      href="/inventory/movements"
      aria-label="View all stock movements"
      className="inline-flex h-8 shrink-0 items-center rounded-md px-2.5 text-xs font-semibold transition-colors duration-150 hover:bg-background-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:ring-offset-1 motion-reduce:transition-none"
      style={{ color: "var(--color-primary)" }}
    >
      View All
    </Link>
  );
}

export function InventoryAnalytics({
  totalUnits,
  inStock,
  lowStock,
  outOfStock,
  oversold,
  stockByCategory,
  categoryCount,
  recentMovements,
}: {
  totalUnits: number;
  inStock: number;
  lowStock: number;
  outOfStock: number;
  oversold: number;
  stockByCategory: { name: string; count: number }[];
  categoryCount: number;
  recentMovements: MovementWithProduct[];
}) {
  const categories = buildCategoryRows(stockByCategory, totalUnits, categoryCount);
  const health = buildStockHealth({ inStock, lowStock, outOfStock, oversold });
  const movements = recentMovements.slice(0, RECENT_MOVEMENT_ROWS);

  return (
    <section aria-labelledby="stock-insights-heading" className="mt-6">
      <style dangerouslySetInnerHTML={{ __html: MOTION_CSS }} />

      <div className="mb-3">
        <h2 id="stock-insights-heading" className="text-base font-semibold text-primary">
          Stock insights
        </h2>
        <p className="mt-0.5 text-xs text-secondary">
          Current stock by category and health, and the latest movements.
        </p>
      </div>

      {/*
        1 column below md, 2 from md (768px), 3 equal from xl (1280px). Grid items stretch, and
        each card is h-full, so the cards in a row share one bottom edge. At two columns the
        movements card spans both, which is what keeps product names untruncated at 1024px.
      */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <section aria-labelledby="stock-insights-category" className={CARD}>
          <DashboardCardHeader
            id="stock-insights-category"
            title="Stock by Category"
            badge={<Qualifier>Units</Qualifier>}
          />
          {categories.length === 0 ? (
            <WidgetEmpty title="No stock recorded yet" />
          ) : (
            <ul className="space-y-3">
              {categories.map((row) => (
                <li key={row.isOther ? "__other" : row.name}>
                  <div className="flex items-baseline justify-between gap-3 text-xs">
                    <span className="min-w-0 text-primary">
                      {row.name}
                      {row.hiddenCategories !== null && (
                        <span className="text-secondary">
                          {" "}
                          ({formatCount(row.hiddenCategories)}{" "}
                          {row.hiddenCategories === 1 ? "category" : "categories"})
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 font-mono tabular-nums text-primary">
                      {formatCount(row.units)}
                      <span className="text-secondary"> · {row.displayPct}%</span>
                    </span>
                  </div>
                  <div
                    aria-hidden="true"
                    className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-background-active"
                  >
                    <div
                      className="inv-bar h-full rounded-full bg-primary motion-reduce:animate-none"
                      style={{ width: `${row.sharePct}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="stock-insights-status" className={CARD}>
          <DashboardCardHeader
            id="stock-insights-status"
            title="Stock by Status"
            badge={<Qualifier>SKUs</Qualifier>}
          />
          {health === null ? (
            <WidgetEmpty title="No stock recorded yet" />
          ) : (
            <>
              <div
                role="img"
                aria-label={health.summary}
                className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-background-active"
              >
                {health.segments
                  .filter((s) => s.count > 0)
                  .map((s) => (
                    <div
                      key={s.key}
                      className={SEGMENT_FILL[s.key]}
                      style={{ width: `${s.sharePct}%` }}
                    />
                  ))}
              </div>
              <ul className="mt-4 space-y-2.5 text-xs">
                {health.segments.map((s) => (
                  <li key={s.key}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2 text-primary">
                        <span
                          aria-hidden="true"
                          className={`h-2.5 w-2.5 shrink-0 rounded-sm ${SEGMENT_FILL[s.key]}`}
                        />
                        {s.label}
                      </span>
                      <span className="shrink-0 font-mono tabular-nums text-primary">
                        {formatCount(s.count)}
                        <span className="text-secondary"> · {s.displayPct}%</span>
                      </span>
                    </div>
                    {s.key === "out" && health.oversold > 0 && (
                      <p className="mt-0.5 pl-[18px] text-xs text-red-700">
                        including {formatCount(health.oversold)} oversold
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section
          aria-labelledby="stock-insights-movements"
          className={`${CARD} md:col-span-2 xl:col-span-1`}
        >
          <DashboardCardHeader
            id="stock-insights-movements"
            title="Recent Movements"
            action={<ViewAllLink />}
          />
          {movements.length === 0 ? (
            <WidgetEmpty title="No movements yet" />
          ) : (
            // A plain list: no max-height, no inner scroller. Five rows fit; the full history is
            // one link away rather than half a row away behind a nested scrollbar.
            <ul className="divide-y divide-slate-100">
              {movements.map((m) => {
                const tone = movementTone(m.quantityDelta, m.balanceAfter);
                const { text, Icon } = TONE[tone];
                const when = formatMovementTime(m.occurredAt);
                const iso = m.occurredAt.toISOString();
                return (
                  <li
                    key={m.id}
                    className="inv-row flex items-start gap-3 py-2.5 first:pt-0 last:pb-0 motion-reduce:animate-none"
                  >
                    <Icon aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${text}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-primary">{m.variant.product.name}</p>
                      <p className="mt-0.5 text-xs text-secondary">
                        <span className="font-mono">{m.variant.sku}</span> ·{" "}
                        {MOVEMENT_LABELS[m.type]}
                        {tone === "oversold" && <span className="text-red-700"> · Oversold</span>}
                      </p>
                      {/* Below sm the time moves under the product rather than disappearing. */}
                      <time dateTime={iso} className="mt-0.5 block text-xs text-secondary sm:hidden">
                        {when}
                      </time>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className={`font-mono text-sm font-semibold tabular-nums ${text}`}>
                        {formatSignedUnits(m.quantityDelta)}
                      </p>
                      <time
                        dateTime={iso}
                        className="mt-0.5 hidden text-xs text-secondary sm:block"
                      >
                        {when}
                      </time>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}
