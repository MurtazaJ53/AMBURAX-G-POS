import { db } from "@/server/db";
import {
  paymentMethodLabel,
  shiftStoreDay,
  startOfStoreDay,
  storeDateKey,
} from "@/server/dashboard/dashboardTransforms";

/**
 * The store sales report: one store, one inclusive range of trading days.
 *
 * Every figure is a sum over completed sales in the range. Voided sales are counted separately
 * and excluded from every total. There is no cost price in the catalogue, so nothing here is
 * margin or profit, and no figure is estimated.
 *
 * Definitions (so the numbers reconcile with Sales and the dashboard):
 * - Net sales = sum of `totalMinor` over completed sales (tax included, as billed).
 * - Tax = sum of `taxMinor` over the same sales.
 * - Refunds = sum of `totalRefundMinor` over completed returns created in the range, which may
 *   belong to sales from an earlier range.
 * - Payments = confirmed tenders only.
 */

/**
 * Store-wide takings and per-cashier figures are management information. Until the owner sets
 * a wider rule, only a tenant OWNER or a STORE_MANAGER may open reports.
 */
export function canViewReports(params: { tenantRole: "OWNER" | "STAFF"; membershipRole: string | null }): boolean {
  return params.tenantRole === "OWNER" || params.membershipRole === "STORE_MANAGER";
}

export const MAX_REPORT_DAYS = 92;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export interface ReportRange {
  /** Inclusive first trading day, YYYY-MM-DD in store time. */
  fromKey: string;
  /** Inclusive last trading day. */
  toKey: string;
  /** Start of the first day. */
  from: Date;
  /** Start of the day after the last day (exclusive bound). */
  to: Date;
  days: number;
}

function dayStartForKey(key: string): Date | null {
  if (!DATE_KEY.test(key)) return null;
  const [y, m, d] = key.split("-").map(Number);
  const noonUtc = new Date(Date.UTC(y!, m! - 1, d!, 12));
  if (noonUtc.getUTCMonth() !== m! - 1 || noonUtc.getUTCDate() !== d) return null;
  return startOfStoreDay(noonUtc);
}

/**
 * Resolve a requested range. Missing or malformed bounds fall back to the last 7 days ending
 * today; a reversed range is swapped; a future end is pulled back to today; a range longer than
 * MAX_REPORT_DAYS is cut to its last MAX_REPORT_DAYS days and reported as clamped.
 */
export function resolveReportRange(
  params: { from?: string | null; to?: string | null },
  now: Date = new Date(),
): ReportRange & { clamped: boolean } {
  const today = startOfStoreDay(now);
  let to = (params.to && dayStartForKey(params.to)) || today;
  let from = (params.from && dayStartForKey(params.from)) || shiftStoreDay(to, 6);
  if (from > to) [from, to] = [to, from];
  if (to > today) to = today;
  if (from > to) from = to;

  let days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  let clamped = false;
  if (days > MAX_REPORT_DAYS) {
    from = shiftStoreDay(to, MAX_REPORT_DAYS - 1);
    days = MAX_REPORT_DAYS;
    clamped = true;
  }
  return {
    fromKey: storeDateKey(from),
    toKey: storeDateKey(to),
    from,
    to: shiftStoreDay(to, -1),
    days,
    clamped,
  };
}

export interface NamedAmount {
  key: string;
  label: string;
  amountMinor: number;
  count: number;
}

export interface SalesReport {
  range: ReportRange;
  billCount: number;
  netSalesMinor: number;
  taxMinor: number;
  itemsSold: number;
  /** Null when there were no bills. */
  averageBillMinor: number | null;
  voidedCount: number;
  returnCount: number;
  refundMinor: number;
  daily: { key: string; billCount: number; netSalesMinor: number }[];
  payments: NamedAmount[];
  cashiers: NamedAmount[];
  categories: NamedAmount[];
  uncategorisedMinor: number;
  products: { variantId: string; name: string; sku: string; units: number; amountMinor: number }[];
  customers: NamedAmount[];
  walkInMinor: number;
  /**
   * Gross profit on lines whose cost was known when they sold (weighted average, excl. GST).
   * Before returns. Lines with no recorded cost are counted in `uncostedUnits`, never guessed.
   */
  profit: {
    revenueExTaxMinor: number;
    costMinor: number;
    profitMinor: number;
    /** Null when nothing costed sold. */
    marginBp: number | null;
    /** Realised profit after deducting customer returns/refunds (Decision E2). */
    netProfitAfterReturnsMinor: number;
    netMarginBp: number | null;
    costedUnits: number;
    uncostedUnits: number;
  };
}

export async function getSalesReport(params: {
  tenantId: string;
  storeId: string;
  range: ReportRange;
  topLimit?: number;
}): Promise<SalesReport> {
  const { tenantId, storeId, range } = params;
  const topLimit = params.topLimit ?? 10;
  const inRange = { gte: range.from, lt: range.to };
  const saleWhere = { tenantId, storeId, status: "COMPLETED" as const, completedAt: inRange };

  const [sales, voidedCount, returns, payments, lines] = await Promise.all([
    db.sale.findMany({
      where: saleWhere,
      select: {
        totalMinor: true,
        taxMinor: true,
        completedAt: true,
        cashierUserId: true,
        customerId: true,
        cashier: { select: { name: true } },
        customer: { select: { name: true } },
      },
    }),
    db.sale.count({ where: { tenantId, storeId, status: "VOIDED", completedAt: inRange } }),
    db.saleReturn.aggregate({
      where: { tenantId, storeId, status: "COMPLETED", createdAt: inRange },
      _sum: { totalRefundMinor: true },
      _count: { _all: true },
    }),
    db.salePayment.groupBy({
      by: ["method"],
      where: { status: "CONFIRMED", sale: saleWhere },
      _sum: { amountMinor: true },
      _count: { _all: true },
    }),
    db.saleItem.findMany({
      where: { tenantId, sale: saleWhere },
      select: {
        variantId: true,
        nameSnapshot: true,
        skuSnapshot: true,
        quantity: true,
        lineTotalMinor: true,
        lineDiscountMinor: true,
        taxMinor: true,
        unitCostMinor: true,
        variant: { select: { product: { select: { category: true } } } },
      },
    }),
  ]);

  // Daily series, one row per trading day in the range including empty days.
  const daily = new Map<string, { key: string; billCount: number; netSalesMinor: number }>();
  for (let i = 0; i < range.days; i++) {
    const key = storeDateKey(shiftStoreDay(range.from, -i));
    daily.set(key, { key, billCount: 0, netSalesMinor: 0 });
  }

  const cashiers = new Map<string, NamedAmount>();
  const customers = new Map<string, NamedAmount>();
  let netSalesMinor = 0;
  let taxMinor = 0;
  let walkInMinor = 0;

  for (const s of sales) {
    netSalesMinor += s.totalMinor;
    taxMinor += s.taxMinor;
    const day = daily.get(storeDateKey(s.completedAt));
    if (day) {
      day.billCount += 1;
      day.netSalesMinor += s.totalMinor;
    }
    const c = cashiers.get(s.cashierUserId) ?? {
      key: s.cashierUserId,
      label: s.cashier.name,
      amountMinor: 0,
      count: 0,
    };
    c.amountMinor += s.totalMinor;
    c.count += 1;
    cashiers.set(s.cashierUserId, c);

    if (s.customerId && s.customer) {
      const cu = customers.get(s.customerId) ?? {
        key: s.customerId,
        label: s.customer.name,
        amountMinor: 0,
        count: 0,
      };
      cu.amountMinor += s.totalMinor;
      cu.count += 1;
      customers.set(s.customerId, cu);
    } else {
      walkInMinor += s.totalMinor;
    }
  }

  const categories = new Map<string, NamedAmount>();
  const products = new Map<string, SalesReport["products"][number]>();
  let itemsSold = 0;
  let costedUnits = 0;
  let uncostedUnits = 0;
  let profitRevenueExTax = 0;
  let profitCost = 0;
  let uncategorisedMinor = 0;
  for (const l of lines) {
    itemsSold += l.quantity;
    if (l.unitCostMinor != null) {
      costedUnits += l.quantity;
      profitRevenueExTax += l.lineTotalMinor - l.lineDiscountMinor - l.taxMinor;
      profitCost += l.unitCostMinor * l.quantity;
    } else {
      uncostedUnits += l.quantity;
    }
    // Net of the line's share of any bill discount, so lines reconcile with net sales.
    const lineNetMinor = l.lineTotalMinor - l.lineDiscountMinor;
    const cat = l.variant.product.category?.trim();
    if (cat) {
      const row = categories.get(cat) ?? { key: cat, label: cat, amountMinor: 0, count: 0 };
      row.amountMinor += lineNetMinor;
      row.count += l.quantity;
      categories.set(cat, row);
    } else {
      uncategorisedMinor += lineNetMinor;
    }
    const p = products.get(l.variantId) ?? {
      variantId: l.variantId,
      name: l.nameSnapshot,
      sku: l.skuSnapshot,
      units: 0,
      amountMinor: 0,
    };
    p.units += l.quantity;
    p.amountMinor += lineNetMinor;
    products.set(l.variantId, p);
  }

  const byAmount = (a: NamedAmount, b: NamedAmount) =>
    b.amountMinor - a.amountMinor || a.label.localeCompare(b.label);

  return {
    range,
    billCount: sales.length,
    netSalesMinor,
    taxMinor,
    itemsSold,
    averageBillMinor: sales.length ? Math.round(netSalesMinor / sales.length) : null,
    voidedCount,
    returnCount: returns._count._all,
    refundMinor: returns._sum.totalRefundMinor ?? 0,
    daily: [...daily.values()],
    payments: payments
      .map((p) => ({
        key: p.method,
        label: paymentMethodLabel(p.method),
        amountMinor: p._sum.amountMinor ?? 0,
        count: p._count._all,
      }))
      .sort(byAmount),
    cashiers: [...cashiers.values()].sort(byAmount),
    categories: [...categories.values()].sort(byAmount),
    uncategorisedMinor,
    products: [...products.values()]
      .sort((a, b) => b.amountMinor - a.amountMinor || b.units - a.units || a.name.localeCompare(b.name))
      .slice(0, topLimit),
    customers: [...customers.values()].sort(byAmount).slice(0, topLimit),
    walkInMinor,
    profit: {
      revenueExTaxMinor: profitRevenueExTax,
      costMinor: profitCost,
      profitMinor: profitRevenueExTax - profitCost,
      marginBp: profitRevenueExTax > 0 ? Math.round(((profitRevenueExTax - profitCost) * 10_000) / profitRevenueExTax) : null,
      netProfitAfterReturnsMinor: (profitRevenueExTax - profitCost) - (returns._sum.totalRefundMinor ?? 0),
      netMarginBp: profitRevenueExTax > 0
        ? Math.round((((profitRevenueExTax - profitCost) - (returns._sum.totalRefundMinor ?? 0)) * 10_000) / profitRevenueExTax)
        : null,
      costedUnits,
      uncostedUnits,
    },
  };
}
