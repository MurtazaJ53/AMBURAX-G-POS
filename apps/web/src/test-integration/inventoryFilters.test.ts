import { describe, expect, it, beforeEach } from "vitest";
import { db, resetDatabase, seedTwoTenants, IDS } from "./db";
import { getInventoryFilterOptions } from "@/server/inventory/inventoryQueries";

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
