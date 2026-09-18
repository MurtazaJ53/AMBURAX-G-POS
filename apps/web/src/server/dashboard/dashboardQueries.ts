import { db } from "@/server/db";

/**
 * Dashboard figures.
 *
 * Every number here is computed from rows this system actually holds. That constraint
 * decided the shape of the whole screen: the design reference shows inventory value,
 * growth percentages, category revenue, a payment-method split, staff shifts and sales
 * targets, and AMBURAX can honestly produce none of them —
 *
 *   - inventory *value* needs a cost price, and `ProductVariant` has none;
 *   - growth percentages need a comparison period the product has not defined;
 *   - targets and shifts have no model at all.
 *
 * So they are absent rather than approximated. A dashboard that guesses is worse than a
 * smaller dashboard that does not, because a merchant will make decisions on it.
 *
 * Everything is tenant- and store-scoped from the caller's resolved session.
 */

/**
 * Midnight in the store's timezone, as a UTC instant.
 *
 * "Today's sales" must mean the trading day the operator is standing in, not a UTC day that
 * rolls over at 05:30 local. India has no daylight saving, so a fixed offset is exact;
 * when per-store timezones become configurable this takes the store's value.
 */
export function startOfStoreDay(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const [year, month, day] = parts.split("-").map(Number);
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  return new Date(Date.UTC(year!, month! - 1, day!, 0, 0, 0, 0) - IST_OFFSET_MS);
}

export interface DashboardTodayMetrics {
  /** Gross takings for the trading day, in minor units. */
  salesMinor: number;
  /** Completed bills. Voided sales are excluded from both figures. */
  billCount: number;
  /** Units across all lines on today's completed sales. */
  itemsSold: number;
  /** Customer records created today. */
  newCustomers: number;
  /** Null when no sale has been rung today — an average of nothing is not zero. */
  averageBillMinor: number | null;
}

export interface DashboardStockSignal {
  /** Variants with a counted stock row in this store. */
  countedVariants: number;
  /** Variants the catalogue holds that have never been counted here. */
  uncountedVariants: number;
  outOfStock: number;
  /**
   * Rows that have gone below zero. Real, and worth surfacing: nothing prevents
   * overselling today, so the projection can drift negative (ADR-080).
   */
  oversold: number;
  /** The thinnest counts in the store, lowest first. */
  lowest: { variantId: string; productName: string; sku: string; quantity: number }[];
}

export async function getTodayMetrics(params: {
  tenantId: string;
  storeId: string;
}): Promise<DashboardTodayMetrics> {
  const since = startOfStoreDay();
  const where = {
    tenantId: params.tenantId,
    storeId: params.storeId,
    status: "COMPLETED" as const,
    completedAt: { gte: since },
  };

  const [aggregate, itemAggregate, newCustomers] = await Promise.all([
    db.sale.aggregate({ where, _sum: { totalMinor: true }, _count: { _all: true } }),
    db.saleItem.aggregate({ where: { sale: where }, _sum: { quantity: true } }),
    db.customer.count({ where: { tenantId: params.tenantId, createdAt: { gte: since } } }),
  ]);

  const salesMinor = aggregate._sum.totalMinor ?? 0;
  const billCount = aggregate._count._all;

  return {
    salesMinor,
    billCount,
    itemsSold: itemAggregate._sum.quantity ?? 0,
    newCustomers,
    // Integer division, floored: an average bill is a display figure, and inventing a
    // fractional paisa would contradict the money rules everywhere else.
    averageBillMinor: billCount > 0 ? Math.floor(salesMinor / billCount) : null,
  };
}

/**
 * The inventory signal for the dashboard.
 *
 * Deliberately not called "low stock". There is no reorder-level column in the schema, so
 * a low-stock claim would need a threshold the product has not defined. What can be stated
 * truthfully is: how many variants are counted here, how many have never been counted, how
 * many are at zero, how many have gone negative, and which are thinnest.
 */
export async function getStockSignal(params: {
  tenantId: string;
  storeId: string;
  lowestLimit?: number;
}): Promise<DashboardStockSignal> {
  const [countedVariants, totalVariants, outOfStock, oversold, lowestRows] = await Promise.all([
    db.stockLevel.count({ where: { storeId: params.storeId } }),
    db.productVariant.count({ where: { tenantId: params.tenantId, isActive: true } }),
    db.stockLevel.count({ where: { storeId: params.storeId, quantity: 0 } }),
    db.stockLevel.count({ where: { storeId: params.storeId, quantity: { lt: 0 } } }),
    db.stockLevel.findMany({
      where: { storeId: params.storeId },
      select: {
        variantId: true,
        quantity: true,
        variant: { select: { sku: true, product: { select: { name: true } } } },
      },
      orderBy: { quantity: "asc" },
      take: Math.min(params.lowestLimit ?? 5, 20),
    }),
  ]);

  return {
    countedVariants,
    uncountedVariants: Math.max(0, totalVariants - countedVariants),
    outOfStock,
    oversold,
    lowest: lowestRows.map((row) => ({
      variantId: row.variantId,
      productName: row.variant.product.name,
      sku: row.variant.sku,
      quantity: row.quantity,
    })),
  };
}
