import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS } from "./db";
import { quickCreateProduct, searchPurchaseItems } from "@/server/purchasing/purchaseItems";

/** Purchases by product name: grouped sizes, stock and last cost; new products with all sizes. */

const owner = { tenantId: IDS.tenantA, userId: IDS.ownerA, tenantRole: "OWNER" as const, membershipRole: "OWNER" };

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
  await db.uom.create({ data: { tenantId: IDS.tenantA, code: "PCS", name: "Pieces" } });
});

afterAll(async () => {
  await resetDatabase();
});

describe("purchase item picker", () => {
  it("finds a product by name with its variants and this store's stock, never another business's", async () => {
    const hits = await searchPurchaseItems({ tenantId: IDS.tenantA, storeId: IDS.storeA, q: "shirt" });
    expect(hits.map((h) => h.productId)).toEqual([COMMERCE_IDS.productA]);
    const v = hits[0]!.variants.find((x) => x.variantId === COMMERCE_IDS.variantA1)!;
    expect(v.stock).toBe(10);
    expect(v.lastCostMinor).toBeNull();
  });

  it("adds a new product with every size x colour, ready to receive; staff can't", async () => {
    const input = {
      storeId: IDS.storeA,
      name: "Cotton Kurta",
      sizes: ["S", "M", "L", " M "],
      colours: ["Blue", "Black"],
      priceMinor: 99_900,
      gst: { treatment: "TAXABLE" as const, rateMode: "FIXED" as const, rateBp: 500 },
    };
    expect((await quickCreateProduct({ ...input, actor: { ...owner, tenantRole: "STAFF", membershipRole: "CASHIER" } })).status).toBe("forbidden");
    const res = await quickCreateProduct({ ...input, actor: owner });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    // S, M, L (duplicate M dropped) x Blue, Black.
    expect(res.product.variants).toHaveLength(6);
    expect(new Set(res.product.variants.map((v) => v.sku)).size).toBe(6);
    expect(res.product.variants.every((v) => v.sku.startsWith("COTTONKURT-"))).toBe(true);
    const found = await searchPurchaseItems({ tenantId: IDS.tenantA, storeId: IDS.storeA, q: "kurta" });
    expect(found[0]?.name).toBe("Cotton Kurta");
  });
});
