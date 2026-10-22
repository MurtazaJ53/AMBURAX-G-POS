import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, IDS, resetDatabase, seedTwoTenants, seedCommerce } from "./db";
import { searchCatalogPage } from "@/server/sales/catalog";

/** The till grid: filters must narrow the results, and pages must reach past the first 30. */

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
  for (let i = 0; i < 35; i++) {
    const product = await db.product.create({
      data: {
        tenantId: IDS.tenantA,
        name: `Item ${String(i).padStart(2, "0")}`,
        category: i % 2 === 0 ? "Kurtas" : "Jeans",
        brand: i < 5 ? "Zed" : "Acme",
      },
      select: { id: true },
    });
    await db.productVariant.create({
      data: {
        tenantId: IDS.tenantA,
        productId: product.id,
        sku: `T-${i}`,
        size: i % 3 === 0 ? "XL" : "M",
        colour: "Black",
        priceMinor: (i + 1) * 10_000,
        taxRateBp: 500,
        taxTreatment: "TAXABLE",
      },
    });
  }
});

afterAll(async () => {
  await resetDatabase();
});

const page = (filters = {}, offset = 0) =>
  searchCatalogPage({ tenantId: IDS.tenantA, storeId: IDS.storeA, query: "Item", filters, offset });

describe("till catalogue search", () => {
  it("returns pages of 30 and says when more remain", async () => {
    const first = await page();
    expect(first.results).toHaveLength(30);
    expect(first.hasMore).toBe(true);
    const second = await page({}, 30);
    expect(second.results).toHaveLength(5);
    expect(second.hasMore).toBe(false);
    const skus = new Set([...first.results, ...second.results].map((r) => r.sku));
    expect(skus.size).toBe(35);
  });

  it("applies category, brand, size and price filters, ignoring case", async () => {
    const kurtas = await page({ category: "kurtas" });
    expect(kurtas.results).toHaveLength(18);
    expect(kurtas.results.every((r) => Number(r.sku.slice(2)) % 2 === 0)).toBe(true);
    expect((await page({ brand: "Zed" })).results).toHaveLength(5);
    expect((await page({ size: "XL" })).results.every((r) => r.size === "XL")).toBe(true);
    const band = await page({ minPriceMinor: 50_000, maxPriceMinor: 99_999 });
    expect(band.results.every((r) => r.priceMinor >= 50_000 && r.priceMinor <= 99_999)).toBe(true);
    expect(band.results).toHaveLength(5);
  });

  it("never shows another tenant's products", async () => {
    const r = await searchCatalogPage({ tenantId: IDS.tenantB, storeId: IDS.storeA, query: "Item" });
    expect(r.results).toHaveLength(0);
  });
});
