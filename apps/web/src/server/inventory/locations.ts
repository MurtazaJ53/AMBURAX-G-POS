import { db } from "@/server/db";
import { listAvailableStores } from "@/server/tenant/storeSelection";
import { LOW_STOCK_MAX_UNITS } from "@/server/inventory/inventoryQueries";

/**
 * Warehouse / location overview (screen 35): every store the viewer can reach, as a stock
 * location. Each AMBURAX store is one ERPNext Warehouse (ERPNext is the stock master), so the
 * mapping and its provisioning state sit on the same row as the numbers.
 */

export interface LocationRow {
  storeId: string;
  name: string;
  code: string;
  city: string;
  isDefault: boolean;
  erpWarehouse: string | null;
  erpStatus: string;
  itemsInStock: number;
  units: number;
  /** Units × weighted average cost; items without a cost are counted in `uncosted`. */
  valueMinor: number;
  uncosted: number;
  low: number;
  out: number;
  /** Units sent from here and not yet received. */
  inTransitOut: number;
  /** Units on their way here. */
  inTransitIn: number;
}

export async function listLocations(viewer: { tenantId: string; userId: string; tenantRole: "OWNER" | "STAFF" }) {
  const stores = await listAvailableStores(viewer);
  if (stores.length === 0) return [];
  const ids = stores.map((s) => s.id);

  const [levels, meta, transit] = await Promise.all([
    db.$queryRaw<
      { storeId: string; items: bigint; units: bigint; valueMinor: bigint | null; uncosted: bigint; low: bigint; out: bigint }[]
    >`
      SELECT sl."storeId",
             COUNT(*) FILTER (WHERE sl."quantity" > 0)                                        AS "items",
             COALESCE(SUM(sl."quantity") FILTER (WHERE sl."quantity" > 0), 0)                  AS "units",
             SUM(sl."quantity"::bigint * sl."avgCostMinor") FILTER (WHERE sl."quantity" > 0 AND sl."avgCostMinor" IS NOT NULL) AS "valueMinor",
             COUNT(*) FILTER (WHERE sl."quantity" > 0 AND sl."avgCostMinor" IS NULL)           AS "uncosted",
             COUNT(*) FILTER (WHERE sl."quantity" > 0 AND sl."quantity" <= ${LOW_STOCK_MAX_UNITS}) AS "low",
             COUNT(*) FILTER (WHERE sl."quantity" <= 0)                                        AS "out"
        FROM "stock_levels" sl
       WHERE sl."tenantId" = ${viewer.tenantId} AND sl."storeId" = ANY(${ids})
       GROUP BY sl."storeId"
    `,
    db.store.findMany({
      where: { tenantId: viewer.tenantId, id: { in: ids } },
      select: { id: true, erpnextWarehouseId: true, erpnextProvisionStatus: true },
    }),
    db.$queryRaw<{ fromStoreId: string; toStoreId: string; units: bigint }[]>`
      SELECT t."fromStoreId", t."toStoreId", COALESCE(SUM(l."quantity"), 0) AS "units"
        FROM "stock_transfers" t
        JOIN "stock_transfer_lines" l ON l."transferId" = t."id" AND l."tenantId" = t."tenantId"
       WHERE t."tenantId" = ${viewer.tenantId} AND t."status" = 'IN_TRANSIT'
         AND (t."fromStoreId" = ANY(${ids}) OR t."toStoreId" = ANY(${ids}))
       GROUP BY t."fromStoreId", t."toStoreId"
    `,
  ]);

  const byStore = new Map(levels.map((l) => [l.storeId, l]));
  const metaById = new Map(meta.map((m) => [m.id, m]));
  return stores.map<LocationRow>((s) => {
    const l = byStore.get(s.id);
    const m = metaById.get(s.id);
    return {
      storeId: s.id,
      name: s.name,
      code: s.code,
      city: s.city,
      isDefault: s.isDefault,
      erpWarehouse: m?.erpnextWarehouseId ?? null,
      erpStatus: m?.erpnextProvisionStatus ?? "NOT_PROVISIONED",
      itemsInStock: Number(l?.items ?? 0),
      units: Number(l?.units ?? 0),
      valueMinor: Number(l?.valueMinor ?? 0),
      uncosted: Number(l?.uncosted ?? 0),
      low: Number(l?.low ?? 0),
      out: Number(l?.out ?? 0),
      inTransitOut: transit.filter((t) => t.fromStoreId === s.id).reduce((a, t) => a + Number(t.units), 0),
      inTransitIn: transit.filter((t) => t.toStoreId === s.id).reduce((a, t) => a + Number(t.units), 0),
    };
  });
}
