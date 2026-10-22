import { db } from "@/server/db";
import {
  bucketByDay,
  bucketByHour,
  paymentMethodLabel,
  shiftStoreDay,
  startOfStoreDay,
  toShares,
  trendRangeDays,
  type ShareRow,
  type TrendPoint,
  type TrendRange,
} from "./dashboardTransforms";

/**
 * Dashboard figures.
 *
 * Every number here is computed from rows this system actually holds. That constraint
 * decided the shape of the whole screen: the design reference shows an inventory valuation,
 * staff shift states and a sales target, and AMBURAX can honestly produce none of them —
 *
 *   - inventory *value* needs a cost price, and `ProductVariant` has none;
 *   - a shift "break" state has no column behind it, only open and closed;
 *   - targets have no model at all.
 *
 * So they are absent rather than approximated. A dashboard that guesses is worse than a
 * smaller dashboard that does not, because a merchant will make decisions on it.
 *
 * What the reference shows and the data *can* support — the hourly trend, category mix,
 * payment split, fastest movers and a real comparison against yesterday — is computed here
 * rather than faked in the component.
 *
 * Everything is tenant- and store-scoped from the caller's resolved session. No function in
 * this file accepts a tenant or store the caller has not already proved they hold.
 */

export { startOfStoreDay };

/** A day's takings, on their own terms. Used for today and for the comparison day alike. */
export interface DayTotals {
  /** Gross takings for the trading day, in minor units. */
  salesMinor: number;
  /** Completed bills. Voided sales are excluded from every figure here. */
  billCount: number;
  /** Units across all lines on that day's completed sales. */
  itemsSold: number;
  /** Customer records created that day. */
  newCustomers: number;
}

export interface DashboardTodayMetrics extends DayTotals {
  /** Null when no sale has been rung — an average of nothing is not zero. */
  averageBillMinor: number | null;
  /** Null for the same reason. One decimal; a bill holds whole items but the mean need not. */
  averageItemsPerBill: number | null;
  /**
   * The same four figures for the previous trading day.
   *
   * Present so the KPI cards can show a real movement rather than a decorative arrow. The
   * card renders "no comparison" when yesterday was a zero day — `percentChange` returns
   * null there rather than inventing a percentage.
   */
  previous: DayTotals;
}

async function dayTotals(params: {
  tenantId: string;
  storeId: string;
  from: Date;
  to: Date;
}): Promise<DayTotals> {
  const where = {
    tenantId: params.tenantId,
    storeId: params.storeId,
    status: "COMPLETED" as const,
    completedAt: { gte: params.from, lt: params.to },
  };

  const [aggregate, itemAggregate, newCustomers] = await Promise.all([
    db.sale.aggregate({ where, _sum: { totalMinor: true }, _count: { _all: true } }),
    db.saleItem.aggregate({ where: { sale: where }, _sum: { quantity: true } }),
    db.customer.count({
      where: {
        tenantId: params.tenantId,
        createdAt: { gte: params.from, lt: params.to },
      },
    }),
  ]);

  return {
    salesMinor: aggregate._sum.totalMinor ?? 0,
    billCount: aggregate._count._all,
    itemsSold: itemAggregate._sum.quantity ?? 0,
    newCustomers,
  };
}

export async function getTodayMetrics(params: {
  tenantId: string;
  storeId: string;
  now?: Date;
}): Promise<DashboardTodayMetrics> {
  const dayStart = startOfStoreDay(params.now);
  const dayEnd = shiftStoreDay(dayStart, -1);
  const previousStart = shiftStoreDay(dayStart, 1);

  const [today, previous] = await Promise.all([
    dayTotals({ ...params, from: dayStart, to: dayEnd }),
    dayTotals({ ...params, from: previousStart, to: dayStart }),
  ]);

  return {
    ...today,
    // Integer division, floored: an average bill is a display figure, and inventing a
    // fractional paisa would contradict the money rules everywhere else.
    averageBillMinor: today.billCount > 0 ? Math.floor(today.salesMinor / today.billCount) : null,
    averageItemsPerBill:
      today.billCount > 0 ? Math.round((today.itemsSold / today.billCount) * 10) / 10 : null,
    previous,
  };
}

/**
 * Sales over time, bucketed in the store's own timezone.
 *
 * Only two columns are read, and only for the window asked for, so even the 30-day range
 * pulls a narrow projection rather than whole sales. Bucketing happens in
 * `dashboardTransforms`, which is where the timezone rule is stated once and tested.
 */
export async function getSalesTrend(params: {
  tenantId: string;
  storeId: string;
  range: TrendRange;
  now?: Date;
}): Promise<TrendPoint[]> {
  const today = startOfStoreDay(params.now);
  const days = trendRangeDays(params.range);
  const lastDay = params.range === "yesterday" ? shiftStoreDay(today, 1) : today;
  const from = shiftStoreDay(lastDay, days - 1);
  const to = shiftStoreDay(lastDay, -1);

  const sales = await db.sale.findMany({
    where: {
      tenantId: params.tenantId,
      storeId: params.storeId,
      status: "COMPLETED",
      completedAt: { gte: from, lt: to },
    },
    select: { completedAt: true, totalMinor: true },
    orderBy: { completedAt: "asc" },
  });

  return days === 1 ? bucketByHour(sales, lastDay) : bucketByDay(sales, lastDay, days);
}

export interface DashboardBreakdown {
  /** Categories ranked by revenue, richest first. */
  categories: ShareRow[];
  /**
   * Revenue on lines whose product has no category set. Reported rather than hidden: if most
   * of the day's takings are uncategorised, the ranking above is not the whole story and the
   * merchant needs to know that before acting on it.
   */
  uncategorisedMinor: number;
  /** The day's fastest movers by units sold. */
  topProducts: {
    variantId: string;
    name: string;
    sku: string;
    unitsSold: number;
    revenueMinor: number;
    /** The product's picture, where the catalogue has one. Null is the common case. */
    imageUrl: string | null;
  }[];
}

/**
 * Category mix and fastest movers, from one pass over the day's sale lines.
 *
 * Both widgets need the same rows, so they share a query rather than each running their own.
 * The line snapshots (`nameSnapshot`, `skuSnapshot`) supply the product names, not the live
 * variant: what was sold is what the bill said, and a product renamed this afternoon must
 * not rewrite this morning's ranking.
 */
export async function getSalesBreakdown(params: {
  tenantId: string;
  storeId: string;
  now?: Date;
  topLimit?: number;
  categoryLimit?: number;
}): Promise<DashboardBreakdown> {
  const dayStart = startOfStoreDay(params.now);
  const dayEnd = shiftStoreDay(dayStart, -1);

  const lines = await db.saleItem.findMany({
    where: {
      tenantId: params.tenantId,
      sale: {
        tenantId: params.tenantId,
        storeId: params.storeId,
        status: "COMPLETED",
        completedAt: { gte: dayStart, lt: dayEnd },
      },
    },
    select: {
      variantId: true,
      nameSnapshot: true,
      skuSnapshot: true,
      quantity: true,
      lineTotalMinor: true,
      lineDiscountMinor: true,
      variant: { select: { product: { select: { category: true, imageUrl: true } } } },
    },
  });

  const byCategory = new Map<string, number>();
  let uncategorisedMinor = 0;
  const byVariant = new Map<
    string,
    {
      variantId: string;
      name: string;
      sku: string;
      unitsSold: number;
      revenueMinor: number;
      imageUrl: string | null;
    }
  >();

  for (const line of lines) {
    // Net of any bill discount allocated to the line.
    const lineNetMinor = line.lineTotalMinor - line.lineDiscountMinor;
    const category = line.variant.product.category?.trim();
    if (category) {
      byCategory.set(category, (byCategory.get(category) ?? 0) + lineNetMinor);
    } else {
      uncategorisedMinor += lineNetMinor;
    }

    const existing = byVariant.get(line.variantId);
    if (existing) {
      existing.unitsSold += line.quantity;
      existing.revenueMinor += lineNetMinor;
    } else {
      byVariant.set(line.variantId, {
        variantId: line.variantId,
        name: line.nameSnapshot,
        sku: line.skuSnapshot,
        unitsSold: line.quantity,
        revenueMinor: lineNetMinor,
        // The picture comes from the live product, unlike the name and SKU beside it, which
        // are the snapshots taken at the till. That asymmetry is deliberate: what the
        // customer was charged for must never change, but a shop that photographs a product
        // today should see that photo against yesterday's sales.
        imageUrl: line.variant.product.imageUrl,
      });
    }
  }

  const { rows: categories } = toShares(
    [...byCategory.entries()].map(([name, amountMinor]) => ({
      key: name,
      label: name,
      amountMinor,
    })),
    { limit: params.categoryLimit ?? 5 },
  );

  const topProducts = [...byVariant.values()]
    .sort(
      (a, b) =>
        b.unitsSold - a.unitsSold ||
        b.revenueMinor - a.revenueMinor ||
        a.name.localeCompare(b.name),
    )
    .slice(0, params.topLimit ?? 5);

  return { categories, uncategorisedMinor, topProducts };
}

/**
 * How the day was paid for.
 *
 * Confirmed tenders only. A payment row is written CONFIRMED by the till at the moment the
 * operator settles the bill, so anything still PENDING is a settlement that did not
 * complete — counting it would overstate money taken.
 */
export async function getPaymentMix(params: {
  tenantId: string;
  storeId: string;
  now?: Date;
}): Promise<{ rows: ShareRow[]; totalMinor: number }> {
  const dayStart = startOfStoreDay(params.now);
  const dayEnd = shiftStoreDay(dayStart, -1);

  const grouped = await db.salePayment.groupBy({
    by: ["method"],
    where: {
      status: "CONFIRMED",
      sale: {
        tenantId: params.tenantId,
        storeId: params.storeId,
        status: "COMPLETED",
        completedAt: { gte: dayStart, lt: dayEnd },
      },
    },
    _sum: { amountMinor: true },
  });

  return toShares(
    grouped.map((row) => ({
      key: row.method,
      label: paymentMethodLabel(row.method),
      amountMinor: row._sum.amountMinor ?? 0,
    })),
  );
}

export interface DashboardShiftActivity {
  /** Shifts open on a till in this store right now. */
  openSessions: number;
  /** Who is on those tills. Names, because a shift is a person, not a count. */
  cashiers: { userId: string; name: string }[];
  /** Everyone with a membership in this store, open shift or not. */
  staffCount: number;
}

/**
 * Who is working, from open POS sessions.
 *
 * Deliberately narrower than the design reference, which shows "8 Active / 1 Break". There
 * is no break state in the schema — a session is open or it is closed — so this reports
 * exactly that, and the widget says "on shift", never "active vs break".
 */
export async function getShiftActivity(params: {
  tenantId: string;
  storeId: string;
}): Promise<DashboardShiftActivity> {
  const [sessions, staffCount] = await Promise.all([
    db.posSession.findMany({
      where: { tenantId: params.tenantId, storeId: params.storeId, closedAt: null },
      select: { cashierUserId: true, cashier: { select: { name: true } } },
      orderBy: { openedAt: "asc" },
      take: 12,
    }),
    db.storeMembership.count({ where: { storeId: params.storeId } }),
  ]);

  const seen = new Map<string, { userId: string; name: string }>();
  for (const session of sessions) {
    if (!seen.has(session.cashierUserId)) {
      seen.set(session.cashierUserId, {
        userId: session.cashierUserId,
        name: session.cashier.name,
      });
    }
  }

  return { openSessions: sessions.length, cashiers: [...seen.values()], staffCount };
}

export interface DashboardStockSignal {
  /** Variants with a counted stock row in this store. */
  countedVariants: number;
  /** Variants the catalogue holds that have never been counted here. */
  uncountedVariants: number;
  outOfStock: number;
  /**
   * Rows that have gone below zero. Real, and worth surfacing: nothing prevents overselling
   * today, so the projection can drift negative (ADR-080).
   */
  oversold: number;
  /**
   * Units on hand x weighted average cost, excluding GST, over levels that have a cost. Null
   * when no unit on hand has a recorded cost.
   */
  stockValueMinor: number | null;
  /** Variants with units on hand but no recorded cost — left out of stockValueMinor. */
  uncostedOnHand: number;
  /** True when part of the value rests on the "older units cost the same" assumption. */
  valueIncludesEstimate: boolean;
  /** The thinnest counts in the store, lowest first. */
  lowest: {
    variantId: string;
    productName: string;
    sku: string;
    quantity: number;
    imageUrl: string | null;
  }[];
}

/**
 * The inventory signal for the dashboard.
 *
 * Deliberately not called "low stock". There is no reorder-level column in the schema, so a
 * low-stock claim would need a threshold the product has not defined. What can be stated
 * truthfully is: how many variants are counted here, how many have never been counted, how
 * many are at zero, how many have gone negative, and which are thinnest.
 */
export async function getStockSignal(params: {
  tenantId: string;
  storeId: string;
  lowestLimit?: number;
}): Promise<DashboardStockSignal> {
  const [countedVariants, totalVariants, outOfStock, oversold, lowestRows, valueRows] = await Promise.all([
    db.stockLevel.count({ where: { storeId: params.storeId } }),
    db.productVariant.count({ where: { tenantId: params.tenantId, isActive: true } }),
    db.stockLevel.count({ where: { storeId: params.storeId, quantity: 0 } }),
    db.stockLevel.count({ where: { storeId: params.storeId, quantity: { lt: 0 } } }),
    db.stockLevel.findMany({
      where: { storeId: params.storeId },
      select: {
        variantId: true,
        quantity: true,
        variant: { select: { sku: true, product: { select: { name: true, imageUrl: true } } } },
      },
      orderBy: { quantity: "asc" },
      take: Math.min(params.lowestLimit ?? 5, 20),
    }),
    // One aggregate in PostgreSQL rather than every level over the wire.
    db.$queryRaw<{ value: bigint | null; uncosted: bigint; estimated: bigint }[]>`
      SELECT SUM(CASE WHEN "avgCostMinor" IS NOT NULL THEN "quantity"::bigint * "avgCostMinor" END) AS "value",
             COUNT(*) FILTER (WHERE "avgCostMinor" IS NULL) AS "uncosted",
             COUNT(*) FILTER (WHERE "avgCostMinor" IS NOT NULL AND "costIsEstimate") AS "estimated"
        FROM "stock_levels"
       WHERE "tenantId" = ${params.tenantId} AND "storeId" = ${params.storeId} AND "quantity" > 0
    `,
  ]);
  const valueRow = valueRows[0];

  return {
    countedVariants,
    uncountedVariants: Math.max(0, totalVariants - countedVariants),
    outOfStock,
    oversold,
    stockValueMinor: valueRow?.value == null ? null : Number(valueRow.value),
    uncostedOnHand: Number(valueRow?.uncosted ?? 0),
    valueIncludesEstimate: Number(valueRow?.estimated ?? 0) > 0,
    lowest: lowestRows.map((row) => ({
      variantId: row.variantId,
      productName: row.variant.product.name,
      sku: row.variant.sku,
      quantity: row.quantity,
      imageUrl: row.variant.product.imageUrl,
    })),
  };
}
