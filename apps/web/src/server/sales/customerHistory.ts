import { db } from "@/server/db";

/**
 * Customer purchase history (screen 39): every completed bill for one customer, with its lines and
 * any refunds against it, newest first, plus what they buy most. Tenant-scoped throughout; another
 * tenant's customer id simply finds nothing.
 */

export const HISTORY_PAGE_SIZE = 20;

export async function getCustomerHistory(params: { tenantId: string; customerId: string; page?: number }) {
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const where = { tenantId: params.tenantId, customerId: params.customerId, status: "COMPLETED" as const };

  const [total, sales, top, refunds] = await Promise.all([
    db.sale.count({ where }),
    db.sale.findMany({
      where,
      orderBy: { completedAt: "desc" },
      skip: (page - 1) * HISTORY_PAGE_SIZE,
      take: HISTORY_PAGE_SIZE,
      select: {
        id: true,
        billNumber: true,
        completedAt: true,
        totalMinor: true,
        store: { select: { name: true } },
        items: {
          select: { id: true, nameSnapshot: true, skuSnapshot: true, quantity: true, lineTotalMinor: true },
          orderBy: { id: "asc" },
        },
        returns: { where: { status: "COMPLETED" }, select: { totalRefundMinor: true } },
      },
    }),
    db.$queryRaw<{ variantId: string; name: string; sku: string; units: bigint; spentMinor: bigint; bills: bigint }[]>`
      SELECT i."variantId", MAX(i."nameSnapshot") AS "name", MAX(i."skuSnapshot") AS "sku",
             SUM(i."quantity") AS "units", SUM(i."lineTotalMinor") AS "spentMinor", COUNT(DISTINCT i."saleId") AS "bills"
        FROM "sale_items" i
        JOIN "sales" s ON s."id" = i."saleId" AND s."tenantId" = i."tenantId"
       WHERE s."tenantId" = ${params.tenantId} AND s."customerId" = ${params.customerId} AND s."status" = 'COMPLETED'
       GROUP BY i."variantId"
       ORDER BY SUM(i."quantity") DESC, SUM(i."lineTotalMinor") DESC
       LIMIT 5
    `,
    db.saleReturn.aggregate({
      where: { tenantId: params.tenantId, status: "COMPLETED", originalSale: { customerId: params.customerId } },
      _sum: { totalRefundMinor: true },
      _count: true,
    }),
  ]);

  return {
    page,
    pages: Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE)),
    total,
    sales: sales.map((s) => ({
      ...s,
      refundedMinor: s.returns.reduce((a, r) => a + r.totalRefundMinor, 0),
    })),
    topItems: top.map((t) => ({
      variantId: t.variantId,
      name: t.name,
      sku: t.sku,
      units: Number(t.units),
      spentMinor: Number(t.spentMinor),
      bills: Number(t.bills),
    })),
    refundCount: refunds._count,
    refundedMinor: refunds._sum.totalRefundMinor ?? 0,
  };
}
