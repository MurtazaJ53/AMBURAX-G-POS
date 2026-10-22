import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase, seedTwoTenants, IDS } from "./db";
import { getInventoryFacetCounts, listStockLevels } from "@/server/inventory/inventoryQueries";

/**
 * Read-only Categories / Brands tabs against real PostgreSQL: values and counts are this tenant's
 * stock rows in this store only, null/blank values are left out, and each count equals the rows
 * the matching stock-list filter returns.
 */

const STORE_A2 = "s-facet-aaaaaaaaaaaaaaaa2";
let n = 0;

async function stocked(opts: { tenantId?: string; storeId?: string; category?: string | null; brand?: string | null; variants?: number }) {
  n += 1;
  const tenantId = opts.tenantId ?? IDS.tenantA;
  const product = await db.product.create({
    data: { tenantId, name: `Facet Product ${n}`, category: opts.category ?? null, brand: opts.brand ?? null },
  });
  for (let i = 0; i < (opts.variants ?? 1); i++) {
    const variant = await db.productVariant.create({
      data: { tenantId, productId: product.id, sku: `FACET-${n}-${i}`, priceMinor: 100 },
    });
    await db.stockLevel.create({
      data: { tenantId, storeId: opts.storeId ?? IDS.storeA, variantId: variant.id, quantity: 3 },
    });
  }
}

const scope = { tenantId: IDS.tenantA, storeId: IDS.storeA };

beforeEach(async () => {
  n = 0;
  await resetDatabase();
  await seedTwoTenants();
  await db.store.create({
    data: { id: STORE_A2, tenantId: IDS.tenantA, name: "Store A2", code: "SA2", currency: "INR", addressLine: "2 St", city: "Pune", state: "MH" },
  });
});

afterAll(async () => {
  await resetDatabase();
});

describe("getInventoryFacetCounts", () => {
  it("returns empty lists when the store has no stock", async () => {
    expect(await getInventoryFacetCounts({ ...scope, kind: "category" })).toEqual([]);
    expect(await getInventoryFacetCounts({ ...scope, kind: "brand" })).toEqual([]);
  });

  it("counts stock rows per value, sorted, skipping null and blank values", async () => {
    await stocked({ category: "Shirts", brand: "Acme", variants: 3 });
    await stocked({ category: "Shirts", brand: "Zeta" });
    await stocked({ category: "Bags", brand: "Acme", variants: 2 });
    await stocked({ category: null, brand: null });
    await stocked({ category: "", brand: "" });

    expect(await getInventoryFacetCounts({ ...scope, kind: "category" })).toEqual([
      { value: "Bags", count: 2 },
      { value: "Shirts", count: 4 },
    ]);
    expect(await getInventoryFacetCounts({ ...scope, kind: "brand" })).toEqual([
      { value: "Acme", count: 5 },
      { value: "Zeta", count: 1 },
    ]);
  });

  it("isolates by tenant and by store", async () => {
    await stocked({ category: "Mine", brand: "MineBrand" });
    await stocked({ storeId: STORE_A2, category: "OtherStore", brand: "OtherStoreBrand" });
    await stocked({ tenantId: IDS.tenantB, storeId: IDS.storeB, category: "OtherTenant", brand: "OtherTenantBrand" });

    expect((await getInventoryFacetCounts({ ...scope, kind: "category" })).map((f) => f.value)).toEqual(["Mine"]);
    expect((await getInventoryFacetCounts({ ...scope, kind: "brand" })).map((f) => f.value)).toEqual(["MineBrand"]);
    expect((await getInventoryFacetCounts({ tenantId: IDS.tenantB, storeId: IDS.storeB, kind: "category" })).map((f) => f.value)).toEqual(["OtherTenant"]);
  });

  it("each count equals the rows the matching stock-list filter returns", async () => {
    await stocked({ category: "Shirts", brand: "Acme", variants: 3 });
    await stocked({ category: "Bags", brand: "Acme" });
    await stocked({ storeId: STORE_A2, category: "Shirts", brand: "Acme", variants: 5 });

    for (const f of await getInventoryFacetCounts({ ...scope, kind: "category" })) {
      expect((await listStockLevels({ ...scope, category: f.value })).total).toBe(f.count);
    }
    for (const f of await getInventoryFacetCounts({ ...scope, kind: "brand" })) {
      expect((await listStockLevels({ ...scope, brand: f.value })).total).toBe(f.count);
    }
  });
});
