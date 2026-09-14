import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS } from "./db";
import {
  createPriceList,
  listPriceLists,
  setPriceListItem,
  listPriceListItems,
  assignCustomerPriceList,
  assignStorePriceList,
  setTenantDefaultPriceList,
  resolvePrice,
  type PricingActor,
} from "@/server/pricing/pricingService";
import { createUom, type UomActor } from "@/server/uom/uomService";
import { createSale } from "@/server/sales/saleService";
import { findProjectionMismatches } from "@/server/inventory/stockLedger";

/**
 * Pricing against REAL PostgreSQL: the resolution chain and its fall-throughs, quantity breaks,
 * validity windows, currency, tenant isolation, the database constraints, and the concurrency
 * protection around a quantity break.
 *
 * The selection arithmetic is pure and lives in `src/test/priceSelection.test.ts`.
 */

const CORR = "corr-pricing";

const ownerA: PricingActor = {
  tenantId: IDS.tenantA,
  userId: IDS.ownerA,
  tenantRole: "OWNER",
  membershipRole: "OWNER",
};
const ownerB: PricingActor = {
  tenantId: IDS.tenantB,
  userId: IDS.ownerB,
  tenantRole: "OWNER",
  membershipRole: "OWNER",
};
const cashierA: PricingActor = {
  tenantId: IDS.tenantA,
  userId: IDS.staffA,
  tenantRole: "STAFF",
  membershipRole: "CASHIER",
};

/** The seeded variant's own price — the last step of the chain. */
const VARIANT_A1_BASE = 100_000;

async function makeUom(actor: PricingActor, code: string, name: string): Promise<string> {
  const uomActor: UomActor = {
    tenantId: actor.tenantId,
    userId: actor.userId,
    tenantRole: actor.tenantRole,
    membershipRole: actor.membershipRole,
  };
  const result = await createUom({ actor: uomActor, code, name, correlationId: CORR });
  if (result.status !== "ok") throw new Error(`uom setup failed: ${result.status}`);
  return result.uom.id;
}

async function makeList(actor: PricingActor, name: string, currency = "INR"): Promise<string> {
  const result = await createPriceList({ actor, name, currency, correlationId: CORR });
  if (result.status !== "ok") throw new Error(`list setup failed: ${result.status}`);
  return result.priceList.id;
}

function setPrice(params: {
  actor?: PricingActor;
  priceListId: string;
  uomId: string;
  variantId?: string;
  minQuantity?: number;
  unitPriceMinor: number;
  validFrom?: Date | null;
  validTo?: Date | null;
}) {
  return setPriceListItem({
    actor: params.actor ?? ownerA,
    priceListId: params.priceListId,
    variantId: params.variantId ?? COMMERCE_IDS.variantA1,
    uomId: params.uomId,
    minQuantity: params.minQuantity,
    unitPriceMinor: params.unitPriceMinor,
    validFrom: params.validFrom,
    validTo: params.validTo,
    correlationId: CORR,
  });
}

function resolve(params: {
  uomId: string;
  quantity: number;
  customerId?: string | null;
  tenantId?: string;
  storeId?: string;
  variantId?: string;
  at?: Date;
}) {
  return resolvePrice({
    tenantId: params.tenantId ?? IDS.tenantA,
    storeId: params.storeId ?? IDS.storeA,
    variantId: params.variantId ?? COMMERCE_IDS.variantA1,
    uomId: params.uomId,
    quantity: params.quantity,
    customerId: params.customerId ?? null,
    at: params.at,
  });
}

let pcsA: string;

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
  pcsA = await makeUom(ownerA, "PCS", "Pieces");
});

afterAll(async () => {
  await resetDatabase();
  await db.$disconnect();
});

describe("price lists", () => {
  it("creates a list and lists it", async () => {
    await makeList(ownerA, "Wholesale Tier 1");
    const lists = await listPriceLists(IDS.tenantA);

    expect(lists).toHaveLength(1);
    expect(lists[0]!.name).toBe("Wholesale Tier 1");
    expect(lists[0]!.currency).toBe("INR");
  });

  it("uppercases the currency and returns the existing list on a replay", async () => {
    const first = await createPriceList({
      actor: ownerA,
      name: "Retail",
      currency: "inr",
      correlationId: CORR,
    });
    const second = await createPriceList({
      actor: ownerA,
      name: "Retail",
      currency: "INR",
      correlationId: CORR,
    });

    expect(first.status === "ok" && first.priceList.currency).toBe("INR");
    expect(second.status === "ok" && second.existing).toBe(true);
    expect(await db.priceList.count({ where: { tenantId: IDS.tenantA } })).toBe(1);
  });

  it("two concurrent creates of the same name produce exactly one list", async () => {
    const [a, b] = await Promise.all([makeList(ownerA, "Tier 1"), makeList(ownerA, "Tier 1")]);
    expect(a).toBe(b);
    expect(await db.priceList.count({ where: { tenantId: IDS.tenantA } })).toBe(1);
  });

  it("rejects a currency that is not a three-letter code", async () => {
    const result = await createPriceList({
      actor: ownerA,
      name: "Bad",
      currency: "Rupees",
      correlationId: CORR,
    });
    expect(result).toMatchObject({ status: "validation_error", field: "currency" });
  });

  it("refuses a cashier — setting what goods cost is not a till operation", async () => {
    const result = await createPriceList({
      actor: cashierA,
      name: "Sneaky",
      currency: "INR",
      correlationId: CORR,
    });
    expect(result.status).toBe("forbidden");
  });
});

describe("the resolution chain", () => {
  it("falls all the way through to the variant's base price when nothing is configured", async () => {
    const result = await resolve({ uomId: pcsA, quantity: 1 });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.unitPriceMinor).toBe(VARIANT_A1_BASE);
    expect(result.source).toBe("VARIANT_BASE");
    expect(result.priceListId).toBeNull();
  });

  it("uses the tenant default when one is set", async () => {
    const list = await makeList(ownerA, "Tenant default");
    await setPrice({ priceListId: list, uomId: pcsA, unitPriceMinor: 90_000 });
    await setTenantDefaultPriceList({ actor: ownerA, priceListId: list, correlationId: CORR });

    const result = await resolve({ uomId: pcsA, quantity: 1 });
    expect(result.status === "ok" && result.unitPriceMinor).toBe(90_000);
    expect(result.status === "ok" && result.source).toBe("TENANT_DEFAULT_LIST");
  });

  it("prefers the store's list over the tenant default", async () => {
    const tenantList = await makeList(ownerA, "Tenant default");
    const storeList = await makeList(ownerA, "Store list");
    await setPrice({ priceListId: tenantList, uomId: pcsA, unitPriceMinor: 90_000 });
    await setPrice({ priceListId: storeList, uomId: pcsA, unitPriceMinor: 85_000 });
    await setTenantDefaultPriceList({ actor: ownerA, priceListId: tenantList, correlationId: CORR });
    await assignStorePriceList({
      actor: ownerA,
      storeId: IDS.storeA,
      priceListId: storeList,
      correlationId: CORR,
    });

    const result = await resolve({ uomId: pcsA, quantity: 1 });
    expect(result.status === "ok" && result.unitPriceMinor).toBe(85_000);
    expect(result.status === "ok" && result.source).toBe("STORE_LIST");
  });

  it("prefers the customer's list over the store's", async () => {
    const storeList = await makeList(ownerA, "Store list");
    const customerList = await makeList(ownerA, "Customer list");
    await setPrice({ priceListId: storeList, uomId: pcsA, unitPriceMinor: 85_000 });
    await setPrice({ priceListId: customerList, uomId: pcsA, unitPriceMinor: 80_000 });
    await assignStorePriceList({
      actor: ownerA,
      storeId: IDS.storeA,
      priceListId: storeList,
      correlationId: CORR,
    });
    await assignCustomerPriceList({
      actor: ownerA,
      customerId: COMMERCE_IDS.customerA,
      priceListId: customerList,
      correlationId: CORR,
    });

    const result = await resolve({ uomId: pcsA, quantity: 1, customerId: COMMERCE_IDS.customerA });
    expect(result.status === "ok" && result.unitPriceMinor).toBe(80_000);
    expect(result.status === "ok" && result.source).toBe("CUSTOMER_LIST");
  });

  it("falls through when the customer's list carries no price for this variant", async () => {
    // The bug this phase must not have: stopping because a list is assigned, rather than because
    // it has an applicable price.
    const customerList = await makeList(ownerA, "Customer list");
    const storeList = await makeList(ownerA, "Store list");
    await setPrice({
      priceListId: customerList,
      uomId: pcsA,
      variantId: COMMERCE_IDS.variantA2,
      unitPriceMinor: 10_000,
    });
    await setPrice({ priceListId: storeList, uomId: pcsA, unitPriceMinor: 85_000 });
    await assignCustomerPriceList({
      actor: ownerA,
      customerId: COMMERCE_IDS.customerA,
      priceListId: customerList,
      correlationId: CORR,
    });
    await assignStorePriceList({
      actor: ownerA,
      storeId: IDS.storeA,
      priceListId: storeList,
      correlationId: CORR,
    });

    const result = await resolve({ uomId: pcsA, quantity: 1, customerId: COMMERCE_IDS.customerA });
    expect(result.status === "ok" && result.source).toBe("STORE_LIST");
    expect(result.status === "ok" && result.unitPriceMinor).toBe(85_000);
  });

  it("falls through when the customer's list has no break low enough", async () => {
    const customerList = await makeList(ownerA, "Customer list");
    await setPrice({
      priceListId: customerList,
      uomId: pcsA,
      minQuantity: 50,
      unitPriceMinor: 70_000,
    });
    await assignCustomerPriceList({
      actor: ownerA,
      customerId: COMMERCE_IDS.customerA,
      priceListId: customerList,
      correlationId: CORR,
    });

    // Asking for 10 when the only break starts at 50: not this list's answer.
    const result = await resolve({ uomId: pcsA, quantity: 10, customerId: COMMERCE_IDS.customerA });
    expect(result.status === "ok" && result.source).toBe("VARIANT_BASE");
  });

  it("falls through every configured list down to the base price", async () => {
    const customerList = await makeList(ownerA, "Customer list");
    const storeList = await makeList(ownerA, "Store list");
    const tenantList = await makeList(ownerA, "Tenant default");
    // All three exist and all three are empty for this variant.
    await assignCustomerPriceList({
      actor: ownerA,
      customerId: COMMERCE_IDS.customerA,
      priceListId: customerList,
      correlationId: CORR,
    });
    await assignStorePriceList({
      actor: ownerA,
      storeId: IDS.storeA,
      priceListId: storeList,
      correlationId: CORR,
    });
    await setTenantDefaultPriceList({ actor: ownerA, priceListId: tenantList, correlationId: CORR });

    const result = await resolve({ uomId: pcsA, quantity: 1, customerId: COMMERCE_IDS.customerA });
    expect(result.status === "ok" && result.source).toBe("VARIANT_BASE");
    expect(result.status === "ok" && result.unitPriceMinor).toBe(VARIANT_A1_BASE);
  });

  it("ignores an inactive list and falls through", async () => {
    const storeList = await makeList(ownerA, "Store list");
    await setPrice({ priceListId: storeList, uomId: pcsA, unitPriceMinor: 85_000 });
    await assignStorePriceList({
      actor: ownerA,
      storeId: IDS.storeA,
      priceListId: storeList,
      correlationId: CORR,
    });
    await db.priceList.update({ where: { id: storeList }, data: { isActive: false } });

    const result = await resolve({ uomId: pcsA, quantity: 1 });
    expect(result.status === "ok" && result.source).toBe("VARIANT_BASE");
  });

  it("resolves without a customer at all", async () => {
    const storeList = await makeList(ownerA, "Store list");
    await setPrice({ priceListId: storeList, uomId: pcsA, unitPriceMinor: 85_000 });
    await assignStorePriceList({
      actor: ownerA,
      storeId: IDS.storeA,
      priceListId: storeList,
      correlationId: CORR,
    });

    const result = await resolve({ uomId: pcsA, quantity: 1 });
    expect(result.status === "ok" && result.source).toBe("STORE_LIST");
  });
});

describe("quantity breaks against the database", () => {
  it("walks the 1 / 10 / 50 ladder exactly as specified", async () => {
    const list = await makeList(ownerA, "Breaks");
    await setPrice({ priceListId: list, uomId: pcsA, minQuantity: 1, unitPriceMinor: 100_000 });
    await setPrice({ priceListId: list, uomId: pcsA, minQuantity: 10, unitPriceMinor: 95_000 });
    await setPrice({ priceListId: list, uomId: pcsA, minQuantity: 50, unitPriceMinor: 90_000 });
    await setTenantDefaultPriceList({ actor: ownerA, priceListId: list, correlationId: CORR });

    const cases: [number, number][] = [
      [1, 100_000],
      [9, 100_000],
      [10, 95_000],
      [49, 95_000],
      [50, 90_000],
      [1_000, 90_000],
    ];

    for (const [quantity, expected] of cases) {
      const result = await resolve({ uomId: pcsA, quantity });
      expect(result.status === "ok" && result.unitPriceMinor).toBe(expected);
    }
  });

  it("the database refuses a duplicate break for the same list, variant and unit", async () => {
    const list = await makeList(ownerA, "Breaks");
    await setPrice({ priceListId: list, uomId: pcsA, minQuantity: 10, unitPriceMinor: 95_000 });

    // The unique key is (priceList, variant, uom, minQuantity) — a raw insert cannot get past it.
    await expect(
      db.priceListItem.create({
        data: {
          tenantId: IDS.tenantA,
          priceListId: list,
          variantId: COMMERCE_IDS.variantA1,
          uomId: pcsA,
          minQuantity: 10,
          unitPriceMinor: 1,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("setting the same break twice replaces the price rather than duplicating it", async () => {
    const list = await makeList(ownerA, "Breaks");
    await setPrice({ priceListId: list, uomId: pcsA, minQuantity: 10, unitPriceMinor: 95_000 });
    const second = await setPrice({
      priceListId: list,
      uomId: pcsA,
      minQuantity: 10,
      unitPriceMinor: 93_000,
    });

    expect(second.status === "ok" && second.replaced).toBe(true);
    const items = await listPriceListItems({ tenantId: IDS.tenantA, priceListId: list });
    expect(items.status === "ok" && items.items).toHaveLength(1);
    expect(items.status === "ok" && items.items[0]!.unitPriceMinor).toBe(93_000);
  });

  it("two concurrent writers of the same break leave exactly one row", async () => {
    // The advisory lock inside the transaction is what makes this deterministic rather than a
    // read-then-write race that can surface a unique violation.
    const list = await makeList(ownerA, "Breaks");
    const [a, b] = await Promise.all([
      setPrice({ priceListId: list, uomId: pcsA, minQuantity: 10, unitPriceMinor: 95_000 }),
      setPrice({ priceListId: list, uomId: pcsA, minQuantity: 10, unitPriceMinor: 93_000 }),
    ]);

    expect([a.status, b.status]).toEqual(["ok", "ok"]);
    expect(await db.priceListItem.count({ where: { priceListId: list } })).toBe(1);
  });

  it("rejects a break below 1", async () => {
    const list = await makeList(ownerA, "Breaks");
    const result = await setPrice({
      priceListId: list,
      uomId: pcsA,
      minQuantity: 0,
      unitPriceMinor: 100,
    });
    expect(result).toMatchObject({ status: "validation_error", field: "minQuantity" });
  });
});

describe("unit awareness", () => {
  it("prices the same variant differently per unit", async () => {
    const carton = await makeUom(ownerA, "CARTON", "Carton");
    const list = await makeList(ownerA, "Units");
    await setPrice({ priceListId: list, uomId: pcsA, unitPriceMinor: 100_000 });
    await setPrice({ priceListId: list, uomId: carton, unitPriceMinor: 2_300_000 });
    await setTenantDefaultPriceList({ actor: ownerA, priceListId: list, correlationId: CORR });

    const perPiece = await resolve({ uomId: pcsA, quantity: 1 });
    const perCarton = await resolve({ uomId: carton, quantity: 1 });

    expect(perPiece.status === "ok" && perPiece.unitPriceMinor).toBe(100_000);
    expect(perCarton.status === "ok" && perCarton.unitPriceMinor).toBe(2_300_000);
  });

  it("a price in one unit does not answer a request in another", async () => {
    const carton = await makeUom(ownerA, "CARTON", "Carton");
    const list = await makeList(ownerA, "Units");
    await setPrice({ priceListId: list, uomId: carton, unitPriceMinor: 2_300_000 });
    await setTenantDefaultPriceList({ actor: ownerA, priceListId: list, correlationId: CORR });

    // Asking in pieces: the carton price is not converted, so the chain falls to the base price.
    const result = await resolve({ uomId: pcsA, quantity: 1 });
    expect(result.status === "ok" && result.source).toBe("VARIANT_BASE");
  });

  it("refuses the base-price fallback in a unit the product is not based in", async () => {
    // The variant's own price is denominated in the product's base unit. Quoting it for a carton
    // would be a silent conversion, which this system refuses to do anywhere.
    const carton = await makeUom(ownerA, "CARTON", "Carton");
    await db.product.update({ where: { id: COMMERCE_IDS.productA }, data: { baseUomId: pcsA } });

    const result = await resolve({ uomId: carton, quantity: 1 });
    expect(result.status).toBe("no_price");
  });
});

describe("validity windows against the database", () => {
  const past = new Date("2026-01-01T00:00:00.000Z");
  const future = new Date("2026-12-31T00:00:00.000Z");

  it("an expired price is not used", async () => {
    const list = await makeList(ownerA, "Seasonal");
    await setPrice({ priceListId: list, uomId: pcsA, unitPriceMinor: 70_000, validTo: past });
    await setTenantDefaultPriceList({ actor: ownerA, priceListId: list, correlationId: CORR });

    const result = await resolve({ uomId: pcsA, quantity: 1 });
    expect(result.status === "ok" && result.source).toBe("VARIANT_BASE");
  });

  it("a price that has not started is not used", async () => {
    const list = await makeList(ownerA, "Seasonal");
    await setPrice({ priceListId: list, uomId: pcsA, unitPriceMinor: 70_000, validFrom: future });
    await setTenantDefaultPriceList({ actor: ownerA, priceListId: list, correlationId: CORR });

    const result = await resolve({ uomId: pcsA, quantity: 1 });
    expect(result.status === "ok" && result.source).toBe("VARIANT_BASE");
  });

  it("a price inside its window is used", async () => {
    const list = await makeList(ownerA, "Seasonal");
    await setPrice({
      priceListId: list,
      uomId: pcsA,
      unitPriceMinor: 70_000,
      validFrom: past,
      validTo: future,
    });
    await setTenantDefaultPriceList({ actor: ownerA, priceListId: list, correlationId: CORR });

    const result = await resolve({ uomId: pcsA, quantity: 1 });
    expect(result.status === "ok" && result.unitPriceMinor).toBe(70_000);
  });

  it("resolution can be asked about another instant", async () => {
    const list = await makeList(ownerA, "Seasonal");
    await setPrice({ priceListId: list, uomId: pcsA, unitPriceMinor: 70_000, validTo: past });
    await setTenantDefaultPriceList({ actor: ownerA, priceListId: list, correlationId: CORR });

    const backThen = await resolve({
      uomId: pcsA,
      quantity: 1,
      at: new Date("2025-06-01T00:00:00.000Z"),
    });
    expect(backThen.status === "ok" && backThen.unitPriceMinor).toBe(70_000);
  });

  it("rejects a window that ends before it starts", async () => {
    const list = await makeList(ownerA, "Seasonal");
    const result = await setPrice({
      priceListId: list,
      uomId: pcsA,
      unitPriceMinor: 70_000,
      validFrom: future,
      validTo: past,
    });
    expect(result).toMatchObject({ status: "validation_error", field: "validTo" });
  });

  it("refuses a second price for the same break in a non-overlapping period", async () => {
    // The unique key holds one row per break, so a second, disjoint window would silently
    // overwrite a price that is still in force for its own period.
    const list = await makeList(ownerA, "Seasonal");
    await setPrice({
      priceListId: list,
      uomId: pcsA,
      unitPriceMinor: 70_000,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validTo: new Date("2026-06-01T00:00:00.000Z"),
    });

    const second = await setPrice({
      priceListId: list,
      uomId: pcsA,
      unitPriceMinor: 60_000,
      validFrom: new Date("2026-07-01T00:00:00.000Z"),
      validTo: new Date("2026-12-01T00:00:00.000Z"),
    });

    expect(second.status).toBe("conflict");
  });
});

describe("currency", () => {
  it("refuses to assign a list in another currency to a store", async () => {
    const usd = await makeList(ownerA, "US list", "USD");
    const result = await assignStorePriceList({
      actor: ownerA,
      storeId: IDS.storeA,
      priceListId: usd,
      correlationId: CORR,
    });

    // The seeded store sells in INR. Prices are never converted.
    expect(result).toMatchObject({ status: "validation_error", field: "priceListId" });
  });

  it("refuses at resolution rather than silently skipping a mismatched list", async () => {
    // A merchant whose price list is quietly ignored would never find out.
    const usd = await makeList(ownerA, "US list", "USD");
    await setPrice({ priceListId: usd, uomId: pcsA, unitPriceMinor: 1_200 });
    await assignCustomerPriceList({
      actor: ownerA,
      customerId: COMMERCE_IDS.customerA,
      priceListId: usd,
      correlationId: CORR,
    });

    const result = await resolve({ uomId: pcsA, quantity: 1, customerId: COMMERCE_IDS.customerA });
    expect(result.status).toBe("currency_mismatch");
  });

  it("never converts — the resolved currency is always the store's", async () => {
    const list = await makeList(ownerA, "Tenant default");
    await setPrice({ priceListId: list, uomId: pcsA, unitPriceMinor: 90_000 });
    await setTenantDefaultPriceList({ actor: ownerA, priceListId: list, correlationId: CORR });

    const result = await resolve({ uomId: pcsA, quantity: 1 });
    expect(result.status === "ok" && result.currency).toBe("INR");
  });
});

describe("zero and invalid prices", () => {
  it("stores and resolves a zero price", async () => {
    const list = await makeList(ownerA, "Free line");
    await setPrice({ priceListId: list, uomId: pcsA, unitPriceMinor: 0 });
    await setTenantDefaultPriceList({ actor: ownerA, priceListId: list, correlationId: CORR });

    const result = await resolve({ uomId: pcsA, quantity: 1 });
    expect(result.status === "ok" && result.unitPriceMinor).toBe(0);
    expect(result.status === "ok" && result.source).toBe("TENANT_DEFAULT_LIST");
  });

  it("rejects a negative price", async () => {
    const list = await makeList(ownerA, "Bad");
    const result = await setPrice({ priceListId: list, uomId: pcsA, unitPriceMinor: -1 });
    expect(result).toMatchObject({ status: "validation_error", field: "unitPriceMinor" });
  });

  it("rejects a fractional price", async () => {
    const list = await makeList(ownerA, "Bad");
    const result = await setPrice({ priceListId: list, uomId: pcsA, unitPriceMinor: 100.5 });
    expect(result).toMatchObject({ status: "validation_error", field: "unitPriceMinor" });
  });

  it("rejects a non-positive resolution quantity", async () => {
    const result = await resolve({ uomId: pcsA, quantity: 0 });
    expect(result).toMatchObject({ status: "validation_error", field: "quantity" });
  });
});

describe("tenant isolation", () => {
  it("a tenant sees only its own price lists", async () => {
    await makeList(ownerA, "A list");
    await makeList(ownerB, "B list");

    expect(await listPriceLists(IDS.tenantA)).toHaveLength(1);
    expect(await listPriceLists(IDS.tenantB)).toHaveLength(1);
  });

  it("tenant A cannot read tenant B's price list items", async () => {
    const bList = await makeList(ownerB, "B list");
    const result = await listPriceListItems({ tenantId: IDS.tenantA, priceListId: bList });
    expect(result).toMatchObject({ status: "not_found", what: "price_list" });
  });

  it("tenant A cannot assign tenant B's list to its customer", async () => {
    const bList = await makeList(ownerB, "B list");
    const result = await assignCustomerPriceList({
      actor: ownerA,
      customerId: COMMERCE_IDS.customerA,
      priceListId: bList,
      correlationId: CORR,
    });
    expect(result).toMatchObject({ status: "not_found", what: "price_list" });
  });

  it("tenant A cannot assign tenant B's list to its store", async () => {
    const bList = await makeList(ownerB, "B list");
    const result = await assignStorePriceList({
      actor: ownerA,
      storeId: IDS.storeA,
      priceListId: bList,
      correlationId: CORR,
    });
    expect(result).toMatchObject({ status: "not_found", what: "price_list" });
  });

  it("tenant A cannot make tenant B's list its tenant default", async () => {
    const bList = await makeList(ownerB, "B list");
    const result = await setTenantDefaultPriceList({
      actor: ownerA,
      priceListId: bList,
      correlationId: CORR,
    });
    expect(result).toMatchObject({ status: "not_found", what: "price_list" });
  });

  it("tenant A cannot price tenant B's variant", async () => {
    const list = await makeList(ownerA, "A list");
    const result = await setPrice({
      priceListId: list,
      uomId: pcsA,
      variantId: COMMERCE_IDS.variantB1,
      unitPriceMinor: 1,
    });
    expect(result).toMatchObject({ status: "not_found", what: "variant" });
  });

  it("tenant A cannot price against tenant B's unit", async () => {
    const bPcs = await makeUom(ownerB, "PCS", "Pieces");
    const list = await makeList(ownerA, "A list");
    const result = await setPrice({ priceListId: list, uomId: bPcs, unitPriceMinor: 1 });
    expect(result).toMatchObject({ status: "not_found", what: "uom" });
  });

  it("tenant A cannot resolve against tenant B's store", async () => {
    const result = await resolve({ uomId: pcsA, quantity: 1, storeId: IDS.storeB });
    expect(result).toMatchObject({ status: "not_found", what: "store" });
  });

  it("tenant B's pricing never leaks into tenant A's resolution", async () => {
    const bList = await makeList(ownerB, "B cheap");
    const bPcs = await makeUom(ownerB, "PCS", "Pieces");
    await setPriceListItem({
      actor: ownerB,
      priceListId: bList,
      variantId: COMMERCE_IDS.variantB1,
      uomId: bPcs,
      unitPriceMinor: 1,
      correlationId: CORR,
    });
    await setTenantDefaultPriceList({ actor: ownerB, priceListId: bList, correlationId: CORR });

    const result = await resolve({ uomId: pcsA, quantity: 1 });
    expect(result.status === "ok" && result.source).toBe("VARIANT_BASE");
    expect(result.status === "ok" && result.unitPriceMinor).toBe(VARIANT_A1_BASE);
  });

  it("PostgreSQL rejects a price list item pointing at another tenant's variant", async () => {
    // The composite foreign keys, not the application guard. Every id is individually valid.
    const list = await makeList(ownerA, "A list");
    await expect(
      db.priceListItem.create({
        data: {
          tenantId: IDS.tenantA,
          priceListId: list,
          variantId: COMMERCE_IDS.variantB1,
          uomId: pcsA,
          minQuantity: 1,
          unitPriceMinor: 100,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("PostgreSQL rejects a customer pointing at another tenant's price list", async () => {
    const bList = await makeList(ownerB, "B list");
    await expect(
      db.customer.update({ where: { id: COMMERCE_IDS.customerA }, data: { priceListId: bList } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("PostgreSQL rejects a store pointing at another tenant's price list", async () => {
    const bList = await makeList(ownerB, "B list");
    await expect(
      db.store.update({ where: { id: IDS.storeA }, data: { priceListId: bList } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("PostgreSQL rejects a tenant default pointing at another tenant's price list", async () => {
    const bList = await makeList(ownerB, "B list");
    await expect(
      db.tenant.update({ where: { id: IDS.tenantA }, data: { defaultPriceListId: bList } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});

describe("regression: the POS, inventory and units are untouched", () => {
  it("a sale still prices from the variant, not from any price list", async () => {
    // saleService is deliberately not wired to pricing in this phase: changing how a sale is
    // priced would change Sale semantics, which belongs to the Order phase.
    const list = await makeList(ownerA, "Cheap list");
    await setPrice({ priceListId: list, uomId: pcsA, unitPriceMinor: 1 });
    await setTenantDefaultPriceList({ actor: ownerA, priceListId: list, correlationId: CORR });

    const sale = await createSale({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      cashierUserId: IDS.ownerA,
      idempotencyKey: `pricing-regression-${Date.now()}`,
      lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 2 }],
      payment: { method: "CASH" },
      correlationId: "corr-sale",
    });

    expect(sale.status).toBe("ok");
    // Two at the variant's own price, tax-inclusive, exactly as before pricing existed.
    expect(sale.status === "ok" && sale.sale.totalMinor).toBe(2 * VARIANT_A1_BASE);
  });

  it("a sale with no price list configured behaves exactly as before", async () => {
    const sale = await createSale({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      cashierUserId: IDS.ownerA,
      idempotencyKey: `pricing-regression-none-${Date.now()}`,
      lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 3 }],
      payment: { method: "CASH" },
      correlationId: "corr-sale",
    });

    expect(sale.status).toBe("ok");
    const level = await db.stockLevel.findUniqueOrThrow({
      where: { storeId_variantId: { storeId: IDS.storeA, variantId: COMMERCE_IDS.variantA1 } },
    });
    expect(level.quantity).toBe(7);
  });

  it("the stock ledger and its projection still reconcile", async () => {
    const list = await makeList(ownerA, "Any list");
    await setPrice({ priceListId: list, uomId: pcsA, unitPriceMinor: 50_000 });
    expect(await findProjectionMismatches(db)).toEqual([]);
  });

  it("quantity and money columns are still integers", async () => {
    const columns = await db.$queryRaw<{ table_name: string; data_type: string }[]>`
      SELECT table_name, data_type
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (
           (table_name = 'sale_items'       AND column_name = 'quantity')       OR
           (table_name = 'stock_levels'     AND column_name = 'quantity')       OR
           (table_name = 'stock_movements'  AND column_name = 'quantityDelta')  OR
           (table_name = 'price_list_items' AND column_name = 'unitPriceMinor')
         )
    `;

    expect(columns).toHaveLength(4);
    for (const column of columns) {
      expect(column.data_type).toBe("integer");
    }
  });
});
