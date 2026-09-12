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
    select: {
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
    },
    orderBy: { completedAt: "desc" },
    take: Math.min(params.limit ?? 50, 100),
  });

  return rows.map((s) => ({
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
  }));
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
