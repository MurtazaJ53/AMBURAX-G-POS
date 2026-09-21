import { db } from "@/server/db";

/**
 * Sale reads — the bill and the history list.
 *
 * Both are driven entirely from the persisted transaction. There is no second "display"
 * representation of a sale anywhere: what the bill shows is what was committed, including
 * the line snapshots taken at the moment of sale, so a later price change cannot rewrite a
 * customer's receipt.
 *
 * Every query is scoped by `tenantId` from the caller's session; `storeId` narrows further
 * where the caller is working in one store.
 */

export interface SaleListRow {
  id: string;
  billNumber: string;
  completedAt: Date;
  totalMinor: number;
  status: string;
  erpSyncStatus: string;
  paymentStatus: string | null;
  paymentMethod: string | null;
  customerName: string | null;
  cashierName: string;
  storeName: string;
}

/** Shared by the capped list and the paginated workspace, so the two cannot drift. */
const SALE_LIST_SELECT = {
  id: true,
  billNumber: true,
  completedAt: true,
  totalMinor: true,
  status: true,
  erpSyncStatus: true,
  customer: { select: { name: true } },
  cashier: { select: { name: true } },
  store: { select: { name: true } },
  payments: { select: { status: true, method: true }, take: 1 },
} as const;

function toListRow(s: {
  id: string;
  billNumber: string;
  completedAt: Date;
  totalMinor: number;
  status: string;
  erpSyncStatus: string;
  customer: { name: string } | null;
  cashier: { name: string };
  store: { name: string };
  payments: { status: string; method: string }[];
}): SaleListRow {
  return {
    id: s.id,
    billNumber: s.billNumber,
    completedAt: s.completedAt,
    totalMinor: s.totalMinor,
    status: s.status,
    erpSyncStatus: s.erpSyncStatus,
    paymentStatus: s.payments[0]?.status ?? null,
    paymentMethod: s.payments[0]?.method ?? null,
    customerName: s.customer?.name ?? null,
    cashierName: s.cashier.name,
    storeName: s.store.name,
  };
}

export async function listSales(params: {
  tenantId: string;
  storeId?: string;
  query?: string;
  limit?: number;
}): Promise<SaleListRow[]> {
  const query = (params.query ?? "").trim();

  const rows = await db.sale.findMany({
    where: {
      tenantId: params.tenantId,
      ...(params.storeId ? { storeId: params.storeId } : {}),
      ...(query.length === 0
        ? {}
        : {
            OR: [
              { billNumber: { contains: query, mode: "insensitive" as const } },
              { customer: { name: { contains: query, mode: "insensitive" as const } } },
              { customer: { phone: { contains: query } } },
            ],
          }),
    },
    select: SALE_LIST_SELECT,
    orderBy: { completedAt: "desc" },
    take: Math.min(params.limit ?? 50, 100),
  });

  return rows.map(toListRow);
}

/* ----------------------------------------------------- the Sales workspace */

export const SALES_PAGE_SIZE = 20;

export interface SalesPage {
  rows: SaleListRow[];
  total: number;
  page: number;
  pageCount: number;
}

export interface SalesFilters {
  query?: string;
  /** Tender filter. Matches a sale carrying at least one payment of this method. */
  method?: "CASH" | "UPI" | "CARD";
  /** Status filter. */
  status?: "COMPLETED" | "VOIDED";
  /** Inclusive start of the range. */
  from?: Date;
  /** Exclusive end of the range. */
  to?: Date;
}

function buildSalesWhere(params: { tenantId: string; storeId?: string } & SalesFilters) {
  const query = (params.query ?? "").trim();

  return {
    tenantId: params.tenantId,
    ...(params.storeId ? { storeId: params.storeId } : {}),
    ...(params.status ? { status: params.status } : {}),
    ...(params.method ? { payments: { some: { method: params.method } } } : {}),
    ...(params.from || params.to
      ? {
          completedAt: {
            ...(params.from ? { gte: params.from } : {}),
            ...(params.to ? { lt: params.to } : {}),
          },
        }
      : {}),
    ...(query.length === 0
      ? {}
      : {
          OR: [
            { billNumber: { contains: query, mode: "insensitive" as const } },
            { customer: { name: { contains: query, mode: "insensitive" as const } } },
            { customer: { phone: { contains: query } } },
          ],
        }),
  };
}

/**
 * A page of sale history.
 *
 * Real pagination against a real count, rather than a silent cap: an operator looking for
 * last month's bill must be able to reach it. `page` is 1-based and clamped, so a
 * hand-typed page number beyond the end lands on the last page instead of an empty screen
 * that reads as lost data.
 */
export async function listSalesPage(
  params: { tenantId: string; storeId?: string; page?: number } & SalesFilters,
): Promise<SalesPage> {
  const where = buildSalesWhere(params);

  const total = await db.sale.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / SALES_PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(params.page ?? 1)), pageCount);

  const rows = await db.sale.findMany({
    where,
    select: SALE_LIST_SELECT,
    orderBy: { completedAt: "desc" },
    skip: (page - 1) * SALES_PAGE_SIZE,
    take: SALES_PAGE_SIZE,
  });

  return { rows: rows.map(toListRow), total, page, pageCount };
}

export interface SalesSummary {
  /** Takings across every sale matching the current filters, in minor units. */
  totalMinor: number;
  billCount: number;
  /** Null when the filtered set is empty — an average of nothing is not zero. */
  averageBillMinor: number | null;
  /** Sales not yet posted to accounting. Today that is all of them (ADR-001). */
  unpostedCount: number;
}

/**
 * Headline figures for the filtered set.
 *
 * Scoped to whatever the operator is currently looking at, so the numbers always describe
 * the rows on screen. There is deliberately no "vs previous period" comparison: the product
 * has not defined what the previous period is, and an arrow without a definition is a
 * decoration that reads as a fact.
 */
export async function getSalesSummary(
  params: { tenantId: string; storeId?: string } & SalesFilters,
): Promise<SalesSummary> {
  const where = buildSalesWhere(params);

  const [aggregate, unpostedCount] = await Promise.all([
    db.sale.aggregate({ where, _sum: { totalMinor: true }, _count: { _all: true } }),
    db.sale.count({ where: { ...where, erpSyncStatus: { not: "SYNCED" } } }),
  ]);

  const totalMinor = aggregate._sum.totalMinor ?? 0;
  const billCount = aggregate._count._all;

  return {
    totalMinor,
    billCount,
    averageBillMinor: billCount > 0 ? Math.floor(totalMinor / billCount) : null,
    unpostedCount,
  };
}

export interface SaleDetail {
  id: string;
  billNumber: string;
  completedAt: Date;
  status: string;
  erpSyncStatus: string;
  erpInvoiceId: string | null;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  storeName: string;
  storeCode: string;
  cashierName: string;
  customer: { name: string; phone: string | null } | null;
  items: {
    id: string;
    name: string;
    sku: string;
    quantity: number;
    unitPriceMinor: number;
    taxRateBp: number;
    taxMinor: number;
    lineDiscountMinor: number;
    lineTotalMinor: number;
  }[];
  payments: {
    method: string;
    status: string;
    amountMinor: number;
    reference: string | null;
    confirmedAt: Date | null;
  }[];
}

/**
 * One sale, for the bill screen.
 *
 * Scoped by `tenantId`, so a sale id belonging to another tenant returns null rather than
 * anyone else's bill — an unknown id and a foreign id are indistinguishable to the caller.
 */
export async function getSaleDetail(params: {
  tenantId: string;
  saleId: string;
}): Promise<SaleDetail | null> {
  const sale = await db.sale.findFirst({
    where: { id: params.saleId, tenantId: params.tenantId },
    select: {
      id: true,
      billNumber: true,
      completedAt: true,
      status: true,
      erpSyncStatus: true,
      erpInvoiceId: true,
      subtotalMinor: true,
      discountMinor: true,
      taxMinor: true,
      totalMinor: true,
      paidMinor: true,
      store: { select: { name: true, code: true } },
      cashier: { select: { name: true } },
      customer: { select: { name: true, phone: true } },
      items: {
        select: {
          id: true,
          nameSnapshot: true,
          skuSnapshot: true,
          quantity: true,
          unitPriceMinor: true,
          taxRateBp: true,
          taxMinor: true,
          lineDiscountMinor: true,
          lineTotalMinor: true,
        },
      },
      payments: {
        select: {
          method: true,
          status: true,
          amountMinor: true,
          reference: true,
          confirmedAt: true,
        },
      },
    },
  });

  if (!sale) return null;

  return {
    id: sale.id,
    billNumber: sale.billNumber,
    completedAt: sale.completedAt,
    status: sale.status,
    erpSyncStatus: sale.erpSyncStatus,
    erpInvoiceId: sale.erpInvoiceId,
    subtotalMinor: sale.subtotalMinor,
    discountMinor: sale.discountMinor,
    taxMinor: sale.taxMinor,
    totalMinor: sale.totalMinor,
    paidMinor: sale.paidMinor,
    storeName: sale.store.name,
    storeCode: sale.store.code,
    cashierName: sale.cashier.name,
    customer: sale.customer ? { name: sale.customer.name, phone: sale.customer.phone } : null,
    // Snapshots, not live joins: the bill shows what was charged, not what the catalogue
    // says today.
    items: sale.items.map((i) => ({
      id: i.id,
      name: i.nameSnapshot,
      sku: i.skuSnapshot,
      quantity: i.quantity,
      unitPriceMinor: i.unitPriceMinor,
      taxRateBp: i.taxRateBp,
      taxMinor: i.taxMinor,
      lineDiscountMinor: i.lineDiscountMinor,
      lineTotalMinor: i.lineTotalMinor,
    })),
    payments: sale.payments,
  };
}

export interface SalesAnalytics {
  trend: { label: string; amountMinor: number }[];
  paymentMix: { method: string; amountMinor: number }[];
  typeMix: { status: string; count: number }[];
}

export async function getSalesAnalytics(
  params: { tenantId: string; storeId?: string } & SalesFilters,
): Promise<SalesAnalytics> {
  const where = buildSalesWhere(params);

  // 1. Payment Mix
  const paymentsGroup = await db.salePayment.groupBy({
    by: ["method"],
    where: {
      status: "CONFIRMED",
      sale: where,
    },
    _sum: { amountMinor: true },
  });
  const paymentMix = paymentsGroup.map(g => ({
    method: g.method,
    amountMinor: g._sum.amountMinor ?? 0,
  }));

  // 2. Type Mix
  const typesGroup = await db.sale.groupBy({
    by: ["status"],
    where,
    _count: { _all: true },
  });
  const typeMix = typesGroup.map(g => ({
    status: g.status,
    count: g._count._all,
  }));

  // 3. Trend (fetch completedAt and totalMinor for in-memory grouping)
  const sales = await db.sale.findMany({
    where: { ...where, status: "COMPLETED" },
    select: { completedAt: true, totalMinor: true },
    orderBy: { completedAt: "asc" },
  });

  const daily = new Map<string, number>();
  for (const s of sales) {
    const d = new Date(s.completedAt);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    daily.set(key, (daily.get(key) ?? 0) + s.totalMinor);
  }

  const trend = Array.from(daily.entries()).map(([label, amountMinor]) => ({
    label,
    amountMinor,
  }));

  return { trend, paymentMix, typeMix };
}
