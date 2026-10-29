import { beforeEach, describe, expect, it } from "vitest";
import { db, IDS, COMMERCE_IDS, resetDatabase, seedTwoTenants, seedCommerce } from "./db";
import { createSale } from "@/server/sales/saleService";

/**
 * A line's `unitPriceMinor` is only a batch selector. It must match the variant's current price
 * or one of its pending (new batch) prices; anything else is refused, never quietly repriced.
 */

let n = 0;
function input(line: { unitPriceMinor?: number }) {
  n += 1;
  return {
    tenantId: IDS.tenantA,
    storeId: IDS.storeA,
    cashierUserId: IDS.ownerA,
    idempotencyKey: `price-hint-${n}-${Date.now()}`,
    lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 1, ...line }],
    payment: { method: "CASH" as const },
    correlationId: "corr-price-hint",
  };
}

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
});

async function current(): Promise<number> {
  return (await db.productVariant.findUniqueOrThrow({ where: { id: COMMERCE_IDS.variantA1 } })).priceMinor;
}

describe("sale line price hint", () => {
  it("refuses a price that matches neither the current nor a pending price", async () => {
    const price = await current();
    const result = await createSale(input({ unitPriceMinor: price - 1 }));
    expect(result).toMatchObject({
      status: "price_mismatch",
      variantId: COMMERCE_IDS.variantA1,
      sentPriceMinor: price - 1,
      currentPriceMinor: price,
    });
    expect(await db.sale.count()).toBe(0);
  });

  it("a bill opened before a price change: refused, updated to the new price, then checked out", async () => {
    const before = await current();
    const bill = input({ unitPriceMinor: before });
    await db.productVariant.update({ where: { id: COMMERCE_IDS.variantA1 }, data: { priceMinor: before + 2_000 } });

    const refused = await createSale(bill);
    expect(refused).toMatchObject({ status: "price_mismatch", sentPriceMinor: before, currentPriceMinor: before + 2_000 });
    if (refused.status !== "price_mismatch") return;

    // What the till does on "Update the bill": the same bill and key, with the line at the new price.
    const updated = await createSale({
      ...bill,
      lines: [{ ...bill.lines[0]!, unitPriceMinor: refused.currentPriceMinor }],
    });
    expect(updated.status).toBe("ok");
    if (updated.status === "ok") {
      expect(updated.sale.subtotalMinor).toBe(before + 2_000);
      expect(updated.duplicate).toBe(false);
    }
  });

  it("uses the current price when the hint matches it or is omitted", async () => {
    const price = await current();
    for (const line of [{ unitPriceMinor: price }, {}]) {
      const result = await createSale(input(line));
      expect(result.status).toBe("ok");
      if (result.status === "ok") expect(result.sale.subtotalMinor).toBe(price);
    }
  });

  it("uses a pending batch price when the hint matches it", async () => {
    const price = await current();
    await db.pendingPriceChange.create({
      data: {
        tenantId: IDS.tenantA,
        variantId: COMMERCE_IDS.variantA1,
        newPriceMinor: price + 5_000,
        previousPriceMinor: price,
        unitsAhead: 3,
      },
    });
    const result = await createSale(input({ unitPriceMinor: price + 5_000 }));
    expect(result.status).toBe("ok");
    if (result.status === "ok") expect(result.sale.subtotalMinor).toBe(price + 5_000);
  });
});
