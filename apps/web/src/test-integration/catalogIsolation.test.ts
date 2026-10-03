import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS } from "./db";
import { getCatalogFacets, getProductDetail, listProducts } from "@/server/catalog/catalogQueries";
import { EMPTY_FILTERS } from "@/server/catalog/catalogFilters";

/**
 * Tenant isolation for the catalogue workspace's reads, against a real PostgreSQL.
 *
 * The component suite proves these queries render correctly; it cannot prove they are scoped,
 * because it never runs a query. This file exists to make the scoping falsifiable: both
 * tenants own a product called "* Shirt" in the same category, priced differently, counted in
 * their own store. If any `where` in `catalogQueries` lost its `tenantId`, a search for
 * "Shirt" would return both and one of these assertions would fail.
 *
 * The filter path is covered as well as the plain path, because the filters build their own
 * `where` — a clause ANDed onto an unscoped base would leak just as badly, and would do it
 * only when a filter happened to be active.
 */

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
});

afterAll(async () => {
  await resetDatabase();
});

const scopeA = { tenantId: IDS.tenantA, storeId: IDS.storeA };
const scopeB = { tenantId: IDS.tenantB, storeId: IDS.storeB };

describe("listProducts is tenant-scoped", () => {
  it("returns only the calling tenant's products", async () => {
    const asA = await listProducts(scopeA);
    const asB = await listProducts(scopeB);

    expect(asA.rows.map((row) => row.name)).toEqual(["A Shirt"]);
    expect(asA.total).toBe(1);
    expect(asB.rows.map((row) => row.name)).toEqual(["B Shirt"]);
    expect(asB.total).toBe(1);
  });

  it("a search that matches the other tenant's product returns nothing", async () => {
    // Both fixtures are called "… Shirt", so an unscoped query would return two rows here.
    const asA = await listProducts({ ...scopeA, query: "Shirt" });
    expect(asA.rows.map((row) => row.id)).toEqual([COMMERCE_IDS.productA]);

    // And the other tenant's SKU is not reachable by SKU search either.
    const bySku = await listProducts({ ...scopeA, query: "B-SHIRT-M" });
    expect(bySku.rows).toHaveLength(0);
    expect(bySku.total).toBe(0);
  });

  it("stays scoped when the filter path builds the where clause", async () => {
    const filtered = await listProducts({
      ...scopeA,
      filters: { ...EMPTY_FILTERS, categories: ["Shirts"], sizes: ["M"] },
    });

    expect(filtered.rows.map((row) => row.id)).toEqual([COMMERCE_IDS.productA]);
    expect(filtered.total).toBe(1);
  });

  it("price sorting cannot pull another tenant's product into the page", async () => {
    // Price sort takes a different code path — it collects ids, aggregates, then re-queries.
    const ascending = await listProducts({
      ...scopeA,
      filters: { ...EMPTY_FILTERS, sort: "price_asc" },
    });
    expect(ascending.rows.map((row) => row.id)).toEqual([COMMERCE_IDS.productA]);

    const descending = await listProducts({
      ...scopeB,
      filters: { ...EMPTY_FILTERS, sort: "price_desc" },
    });
    expect(descending.rows.map((row) => row.id)).toEqual([COMMERCE_IDS.productB]);
  });

  it("reports only the calling store's counted stock", async () => {
    const asA = await listProducts(scopeA);
    // 10 + 4 in store A. Store B's 7 belongs to another tenant entirely.
    expect(asA.rows[0]!.stockQuantity).toBe(14);

    const asB = await listProducts(scopeB);
    expect(asB.rows[0]!.stockQuantity).toBe(7);
  });
});

describe("getProductDetail is tenant-scoped", () => {
  it("returns null for a product id belonging to another tenant", async () => {
    // The id is real and the row exists — it simply is not this tenant's to read.
    const leaked = await getProductDetail({ ...scopeA, productId: COMMERCE_IDS.productB });
    expect(leaked).toBeNull();

    const other = await getProductDetail({ ...scopeB, productId: COMMERCE_IDS.productA });
    expect(other).toBeNull();
  });

  it("returns the tenant's own product in full", async () => {
    const detail = await getProductDetail({ ...scopeA, productId: COMMERCE_IDS.productA });

    expect(detail).not.toBeNull();
    expect(detail!.product.name).toBe("A Shirt");
    expect(detail!.product.variantCount).toBe(2);
    expect(detail!.product.variants.map((v) => v.sku).sort()).toEqual(["A-SHIRT-L", "A-SHIRT-M"]);
  });

  it("the per-store stock breakdown never names another tenant's store", async () => {
    const detail = await getProductDetail({ ...scopeA, productId: COMMERCE_IDS.productA });

    expect(detail!.storeStock.map((row) => row.storeId)).toEqual([IDS.storeA]);
    expect(detail!.storeStock[0]!.quantity).toBe(14);
    expect(detail!.storeStock.some((row) => row.storeId === IDS.storeB)).toBe(false);
  });

  it("reports no sales for a product that has never sold", async () => {
    // Null rather than a row of zeroes: "nothing in 30 days" and "never sold" differ.
    const detail = await getProductDetail({ ...scopeA, productId: COMMERCE_IDS.productA });
    expect(detail!.sales).toBeNull();
  });
});

describe("getCatalogFacets is tenant-scoped", () => {
  it("counts only the calling tenant's products", async () => {
    const asA = await getCatalogFacets(scopeA);

    // Both tenants have a "Shirts" category with one product each. A leak would read 2.
    expect(asA.categories).toEqual([{ value: "Shirts", count: 1 }]);
  });

  it("offers only sizes and colours the tenant's own variants use", async () => {
    const asA = await getCatalogFacets(scopeA);
    const asB = await getCatalogFacets(scopeB);

    expect(asA.sizes).toEqual(["M", "L"]);
    expect(asA.colours).toEqual(["White"]);

    // Black belongs to tenant B alone, and must not appear as a filter option for A.
    expect(asA.colours).not.toContain("Black");
    expect(asB.colours).toEqual(["Black"]);
  });

  it("price bounds come from the tenant's own variants", async () => {
    const asA = await getCatalogFacets(scopeA);
    const asB = await getCatalogFacets(scopeB);

    expect(asA.priceFloorMinor).toBe(100_000);
    expect(asA.priceCeilingMinor).toBe(200_000);
    // B's single variant is 150_000 — inside A's range, so a leak would not move A's bounds
    // but would widen B's beyond its own catalogue.
    expect(asB.priceFloorMinor).toBe(150_000);
    expect(asB.priceCeilingMinor).toBe(150_000);
  });

  it("stock facets count this tenant's products in this tenant's store", async () => {
    const asA = await getCatalogFacets(scopeA);

    expect(asA.stock.in).toBe(1);
    expect(asA.stock.out).toBe(0);
    expect(asA.stock.uncounted).toBe(0);

    // A product counted only in the other tenant's store is not "in stock" here.
    const asB = await getCatalogFacets(scopeB);
    expect(asB.stock.in).toBe(1);
  });

  it("a product counted nowhere is reported as never counted, not out of stock", async () => {
    await db.product.create({
      data: { id: "p-uncounted-aaaaaaaaaaaa", tenantId: IDS.tenantA, name: "A Scarf" },
    });
    await db.productVariant.create({
      data: {
        id: "v-uncounted-aaaaaaaaaaaa",
        tenantId: IDS.tenantA,
        productId: "p-uncounted-aaaaaaaaaaaa",
        sku: "A-SCARF",
        priceMinor: 50_000,
        taxRateBp: 500,
      },
    });

    const facets = await getCatalogFacets(scopeA);
    expect(facets.stock.uncounted).toBe(1);
    expect(facets.stock.out).toBe(0);

    const uncountedOnly = await listProducts({
      ...scopeA,
      filters: { ...EMPTY_FILTERS, stock: ["uncounted"] },
    });
    expect(uncountedOnly.rows.map((row) => row.name)).toEqual(["A Scarf"]);
    expect(uncountedOnly.rows[0]!.stockQuantity).toBeNull();
  });
});
