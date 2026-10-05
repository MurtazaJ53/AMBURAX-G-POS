import { describe, expect, it, beforeEach } from "vitest";
import { db, resetDatabase, seedTwoTenants, IDS } from "./db";
import {
  LOW_STOCK_MAX_UNITS,
  getInventoryFilterOptions,
  getInventoryOverview,
  listStockLevels,
} from "@/server/inventory/inventoryQueries";

describe("getInventoryFilterOptions", () => {
  beforeEach(async () => {
    await resetDatabase();
    await seedTwoTenants();
  });

  it("returns categories and brands scoped to the current store, isolating from other stores and tenants", async () => {
    const storeA2 = await db.store.create({
      data: {
        id: "store_A2",
        tenantId: IDS.tenantA,
        name: "Store A2",
        code: "SA2",
        currency: "INR",
        addressLine: "1 A2 Street",
        city: "Mumbai",
        state: "MH",
        isDefault: false,
      }
    });

    // Product for Tenant A, Store 1 (category: 'Mens', brand: 'Nike')
    const pA1 = await db.product.create({
      data: { tenantId: IDS.tenantA, name: "Product A1", category: "Mens", brand: "Nike" }
    });
    const vA1 = await db.productVariant.create({
      data: { tenantId: IDS.tenantA, productId: pA1.id, sku: "SKU-A1", priceMinor: 100 }
    });
    await db.stockLevel.create({
      data: { tenantId: IDS.tenantA, storeId: IDS.storeA, variantId: vA1.id, quantity: 5 }
    });

    // Product for Tenant A, Store 2 (category: 'Womens', brand: 'Adidas')
    const pA2 = await db.product.create({
      data: { tenantId: IDS.tenantA, name: "Product A2", category: "Womens", brand: "Adidas" }
    });
    const vA2 = await db.productVariant.create({
      data: { tenantId: IDS.tenantA, productId: pA2.id, sku: "SKU-A2", priceMinor: 100 }
    });
    await db.stockLevel.create({
      data: { tenantId: IDS.tenantA, storeId: storeA2.id, variantId: vA2.id, quantity: 5 }
    });

    // Product for Tenant B, Store 1 (category: 'Kids', brand: 'Puma')
    const pB1 = await db.product.create({
      data: { tenantId: IDS.tenantB, name: "Product B1", category: "Kids", brand: "Puma" }
    });
    const vB1 = await db.productVariant.create({
      data: { tenantId: IDS.tenantB, productId: pB1.id, sku: "SKU-B1", priceMinor: 100 }
    });
    await db.stockLevel.create({
      data: { tenantId: IDS.tenantB, storeId: IDS.storeB, variantId: vB1.id, quantity: 5 }
    });

    // Product with no stock level should not appear
    await db.product.create({
      data: { tenantId: IDS.tenantA, name: "Product A3", category: "Accessories", brand: "Reebok" }
    });

    // Product with null category/brand
    const pNull = await db.product.create({
      data: { tenantId: IDS.tenantA, name: "Product A4" } // null category and brand
    });
    const vNull = await db.productVariant.create({
      data: { tenantId: IDS.tenantA, productId: pNull.id, sku: "SKU-A4", priceMinor: 100 }
    });
    await db.stockLevel.create({
      data: { tenantId: IDS.tenantA, storeId: IDS.storeA, variantId: vNull.id, quantity: 5 }
    });

    // Query for Tenant A, Store 1
    const resA1 = await getInventoryFilterOptions({ tenantId: IDS.tenantA, storeId: IDS.storeA });
    expect(resA1.categories).toEqual(["Mens"]);
    expect(resA1.brands).toEqual(["Nike"]);

    // Query for Tenant A, Store 2
    const resA2 = await getInventoryFilterOptions({ tenantId: IDS.tenantA, storeId: storeA2.id });
    expect(resA2.categories).toEqual(["Womens"]);
    expect(resA2.brands).toEqual(["Adidas"]);

    // Query for Tenant B, Store 1
    const resB1 = await getInventoryFilterOptions({ tenantId: IDS.tenantB, storeId: IDS.storeB });
    expect(resB1.categories).toEqual(["Kids"]);
    expect(resB1.brands).toEqual(["Puma"]);
  });
});

describe("listStockLevels status filter", () => {
  /**
   * Store A holds the demo store's real split — 66 SKUs above the threshold, 30 low, 7 at zero
   * and 2 oversold, 105 in all — so the filter is checked against the numbers the screen shows.
   * Store A2 (same tenant) and tenant B hold stock that must never leak into store A's results.
   */
  const DEMO_SPLIT = [
    ...Array.from({ length: 66 }, (_, i) => 11 + (i % 40)),
    ...Array.from({ length: 30 }, (_, i) => 1 + (i % 10)),
    ...Array.from({ length: 7 }, () => 0),
    -7,
    -4,
  ];

  async function stock(tenantId: string, storeId: string, sku: string, quantity: number) {
    const product = await db.product.create({ data: { tenantId, name: `Product ${sku}` } });
    const variant = await db.productVariant.create({
      data: { tenantId, productId: product.id, sku, priceMinor: 100 },
    });
    await db.stockLevel.create({ data: { tenantId, storeId, variantId: variant.id, quantity } });
  }

  beforeEach(async () => {
    await resetDatabase();
    await seedTwoTenants();
    await db.store.create({
      data: {
        id: "store_A2",
        tenantId: IDS.tenantA,
        name: "Store A2",
        code: "SA2",
        currency: "INR",
        addressLine: "1 A2 Street",
        city: "Mumbai",
        state: "MH",
        isDefault: false,
      },
    });
    for (const [i, q] of DEMO_SPLIT.entries()) await stock(IDS.tenantA, IDS.storeA, `A-${i}`, q);
    for (const [i, q] of [50, 5, 0, -2].entries()) await stock(IDS.tenantA, "store_A2", `A2-${i}`, q);
    for (const [i, q] of [80, 3, 0, -1].entries()) await stock(IDS.tenantB, IDS.storeB, `B-${i}`, q);
  });

  const list = (status: string) =>
    listStockLevels({ tenantId: IDS.tenantA, storeId: IDS.storeA, status, limit: 500 });

  it("In Stock returns only quantities above the threshold, and as many as the overview counts", async () => {
    const { items, total } = await list("in_stock");
    const overview = await getInventoryOverview({ tenantId: IDS.tenantA, storeId: IDS.storeA });

    expect(items.every((i) => i.quantity > LOW_STOCK_MAX_UNITS)).toBe(true);
    expect(items.some((i) => i.quantity <= LOW_STOCK_MAX_UNITS)).toBe(false);
    expect(total).toBe(overview.inStock);
    expect(total).toBe(66);
  });

  it("Low Stock returns 1 through the threshold, both ends included", async () => {
    const { items, total } = await list("low_stock");
    const quantities = new Set(items.map((i) => i.quantity));

    expect(items.every((i) => i.quantity >= 1 && i.quantity <= LOW_STOCK_MAX_UNITS)).toBe(true);
    expect(quantities.has(1)).toBe(true);
    expect(quantities.has(LOW_STOCK_MAX_UNITS)).toBe(true);
    expect(total).toBe(30);
  });

  it("Out of Stock returns zero and oversold balances", async () => {
    const { items, total } = await list("out_of_stock");

    expect(items.every((i) => i.quantity <= 0)).toBe(true);
    expect(items.filter((i) => i.quantity === 0)).toHaveLength(7);
    expect(items.filter((i) => i.quantity < 0).map((i) => i.quantity).sort((a, b) => a - b)).toEqual([-7, -4]);
    expect(total).toBe(9);
  });

  it("the three filters partition the store with nothing from another store or tenant", async () => {
    const all = await listStockLevels({ tenantId: IDS.tenantA, storeId: IDS.storeA, limit: 500 });
    const parts = await Promise.all(["in_stock", "low_stock", "out_of_stock"].map(list));

    expect(all.total).toBe(105);
    expect(parts.reduce((s, p) => s + p.total, 0)).toBe(all.total);
    for (const p of parts) {
      expect(p.items.every((i) => i.tenantId === IDS.tenantA && i.storeId === IDS.storeA)).toBe(true);
      expect(p.items.some((i) => /^(A2|B)-/.test(i.variant.sku))).toBe(false);
    }

    const otherStore = await listStockLevels({ tenantId: IDS.tenantA, storeId: "store_A2", status: "in_stock" });
    expect(otherStore.items.map((i) => i.variant.sku)).toEqual(["A2-0"]);
    const crossTenant = await listStockLevels({ tenantId: IDS.tenantA, storeId: IDS.storeB, status: "in_stock" });
    expect(crossTenant.total).toBe(0);
  });
});
