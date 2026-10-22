import { db } from "@/server/db";

/**
 * Aging / dead stock (screen 33): items on the shelf of one store that have not sold in a chosen
 * window. The window is the viewer's choice on the screen; no single "dead" threshold is fixed
 * here, because that is the owner's decision (latter.md question 15).
 */

export const AGING_WINDOWS = [30, 60, 90, 180] as const;
export type AgingWindow = (typeof AGING_WINDOWS)[number];

export function isAgingWindow(n: number): n is AgingWindow {
  return (AGING_WINDOWS as readonly number[]).includes(n);
}

export interface AgingRow {
  variantId: string;
  productName: string;
  sku: string;
  size: string | null;
  colour: string | null;
  quantity: number;
  /** Null when this store has never sold it. */
  lastSoldAt: Date | null;
  /** Number of full days since last sold; null when never sold. */
  daysUnsold: number | null;
  /** Units x weighted average cost; null when no cost is recorded. */
  valueMinor: number | null;
}

export async function listAgingStock(params: {
  tenantId: string;
  storeId: string;
  days: AgingWindow;
  limit?: number;
  now?: Date;
}): Promise<{ rows: AgingRow[]; totalUnits: number; totalValueMinor: number; uncostedItems: number }> {
  const since = new Date((params.now ?? new Date()).getTime() - params.days * 86_400_000);
  const rows = await db.$queryRaw<
    {
      variantId: string;
      productName: string;
      sku: string;
      size: string | null;
      colour: string | null;
      quantity: number;
      lastSoldAt: Date | null;
      avgCostMinor: number | null;
    }[]
  >`
    SELECT sl."variantId", p."name" AS "productName", v."sku", v."size", v."colour", sl."quantity",
           last_sale."at" AS "lastSoldAt", sl."avgCostMinor"
      FROM "stock_levels" sl
      JOIN "product_variants" v ON v."id" = sl."variantId" AND v."tenantId" = sl."tenantId"
      JOIN "products" p ON p."id" = v."productId" AND p."tenantId" = v."tenantId"
      LEFT JOIN LATERAL (
        SELECT MAX(m."occurredAt") AS "at"
          FROM "stock_movements" m
         WHERE m."tenantId" = sl."tenantId" AND m."storeId" = sl."storeId"
           AND m."variantId" = sl."variantId" AND m."type" = 'SALE'
      ) last_sale ON TRUE
     WHERE sl."tenantId" = ${params.tenantId}
       AND sl."storeId" = ${params.storeId}
       AND sl."quantity" > 0
       AND (last_sale."at" IS NULL OR last_sale."at" < ${since})
     ORDER BY last_sale."at" ASC NULLS FIRST, sl."quantity" DESC
     LIMIT ${Math.min(params.limit ?? 200, 500)}
  `;
  const nowMs = (params.now ?? new Date()).getTime();
  const mapped = rows.map((r) => ({
    variantId: r.variantId,
    productName: r.productName,
    sku: r.sku,
    size: r.size,
    colour: r.colour,
    quantity: Number(r.quantity),
    lastSoldAt: r.lastSoldAt,
    daysUnsold: r.lastSoldAt ? Math.floor((nowMs - new Date(r.lastSoldAt).getTime()) / 86_400_000) : null,
    valueMinor: r.avgCostMinor == null ? null : Number(r.quantity) * Number(r.avgCostMinor),
  }));
  return {
    rows: mapped,
    totalUnits: mapped.reduce((s, r) => s + r.quantity, 0),
    totalValueMinor: mapped.reduce((s, r) => s + (r.valueMinor ?? 0), 0),
    uncostedItems: mapped.filter((r) => r.valueMinor === null).length,
  };
}
