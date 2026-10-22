import { db } from "@/server/db";

/**
 * How much of each line on a bill has already gone back.
 *
 * The till needs this to show what is still returnable, so a manager is not invited to type a
 * quantity the service will refuse. It is a convenience for the screen and nothing more: the
 * authoritative check still happens inside `createReturn`'s serialisable transaction, which
 * re-aggregates the same rows at commit time. Two managers refunding the same shirt at once
 * will still be caught there, not here.
 *
 * Scoped by tenant through the return's own `tenantId`, so one tenant cannot learn the return
 * history of another's bill by guessing a sale id.
 */
export async function getReturnedQuantities(params: {
  tenantId: string;
  saleId: string;
}): Promise<Record<string, number>> {
  const rows = await db.saleReturnItem.groupBy({
    by: ["originalSaleItemId"],
    where: {
      saleReturn: {
        tenantId: params.tenantId,
        originalSaleId: params.saleId,
      },
    },
    _sum: { quantity: true },
  });

  const returned: Record<string, number> = {};
  for (const row of rows) {
    returned[row.originalSaleItemId] = row._sum.quantity ?? 0;
  }
  return returned;
}

export interface ReturnDetail {
  id: string;
  status: string;
  totalRefundMinor: number;
  reason: string | null;
  createdAt: Date;
  erpSyncStatus: string;
  erpInvoiceId: string | null;
  originalSaleId: string;
  originalBillNumber: string;
  storeName: string;
  items: {
    id: string;
    /** From the original sale line's snapshot, not the live product. */
    name: string;
    sku: string;
    quantity: number;
    refundMinor: number;
    soldQuantity: number;
    soldLineTotalMinor: number;
  }[];
  payments: {
    method: string;
    amountMinor: number;
    status: string;
    reference: string | null;
    confirmedAt: Date | null;
  }[];
}

/**
 * One recorded return, for its detail screen.
 *
 * Three things are scoped deliberately. The tenant comes from the session, never the request.
 * The return must also belong to the sale named in the route, so a valid id cannot be read
 * through someone else's bill. And both failures return `null` rather than a distinguishable
 * error — following `getSaleDetail`, an unknown id and a foreign id look identical to the
 * caller, so nobody can probe for which returns exist.
 *
 * Item descriptions come from `SaleItem.nameSnapshot` / `skuSnapshot` through the
 * `originalSaleItem` relation. `SaleReturnItem` has no snapshot of its own, and reading the live
 * product instead would silently rewrite history every time a product is renamed — the refund
 * has to keep saying what was actually sold.
 */
export async function getReturnDetail(params: {
  tenantId: string;
  saleId: string;
  returnId: string;
}): Promise<ReturnDetail | null> {
  const saleReturn = await db.saleReturn.findFirst({
    where: {
      id: params.returnId,
      tenantId: params.tenantId,
      originalSaleId: params.saleId,
    },
    select: {
      id: true,
      status: true,
      totalRefundMinor: true,
      reason: true,
      createdAt: true,
      erpSyncStatus: true,
      erpInvoiceId: true,
      originalSaleId: true,
      originalSale: { select: { billNumber: true, store: { select: { name: true } } } },
      items: {
        select: {
          id: true,
          quantity: true,
          refundMinor: true,
          originalSaleItem: {
            select: {
              nameSnapshot: true,
              skuSnapshot: true,
              quantity: true,
              lineTotalMinor: true,
            },
          },
        },
      },
      payments: {
        select: {
          method: true,
          amountMinor: true,
          status: true,
          reference: true,
          confirmedAt: true,
        },
      },
    },
  });

  if (!saleReturn) return null;

  return {
    id: saleReturn.id,
    status: saleReturn.status,
    totalRefundMinor: saleReturn.totalRefundMinor,
    reason: saleReturn.reason,
    createdAt: saleReturn.createdAt,
    erpSyncStatus: saleReturn.erpSyncStatus,
    erpInvoiceId: saleReturn.erpInvoiceId,
    originalSaleId: saleReturn.originalSaleId,
    originalBillNumber: saleReturn.originalSale.billNumber,
    storeName: saleReturn.originalSale.store.name,
    items: saleReturn.items.map((item) => ({
      id: item.id,
      name: item.originalSaleItem.nameSnapshot,
      sku: item.originalSaleItem.skuSnapshot,
      quantity: item.quantity,
      refundMinor: item.refundMinor,
      soldQuantity: item.originalSaleItem.quantity,
      soldLineTotalMinor: item.originalSaleItem.lineTotalMinor,
    })),
    payments: saleReturn.payments.map((payment) => ({
      method: payment.method,
      amountMinor: payment.amountMinor,
      status: payment.status,
      reference: payment.reference,
      confirmedAt: payment.confirmedAt,
    })),
  };
}
