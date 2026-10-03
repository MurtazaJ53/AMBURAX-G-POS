import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS } from "./db";
import {
  createUom,
  listUoms,
  createUomConversion,
  listUomConversions,
  resolveConversion,
  assignProductBaseUom,
  type UomActor,
} from "@/server/uom/uomService";
import { createSale } from "@/server/sales/saleService";
import { receiveStock } from "@/server/inventory/inventoryService";
import { findProjectionMismatches } from "@/server/inventory/stockLedger";

/**
 * The UOM foundation against REAL PostgreSQL: tenant isolation, the composite foreign keys, the
 * uniqueness that has to hold under concurrency, and the regression proof that nothing about
 * quantities changed.
 *
 * The arithmetic itself is pure and lives in `src/test/uomConversion.test.ts`.
 */

const ownerA: UomActor = {
  tenantId: IDS.tenantA,
  userId: IDS.ownerA,
  tenantRole: "OWNER",
  membershipRole: "OWNER",
};
const ownerB: UomActor = {
  tenantId: IDS.tenantB,
  userId: IDS.ownerB,
  tenantRole: "OWNER",
  membershipRole: "OWNER",
};
const cashierA: UomActor = {
  tenantId: IDS.tenantA,
  userId: IDS.staffA,
  tenantRole: "STAFF",
  membershipRole: "CASHIER",
};

const CORR = "corr-uom";

function makeUom(actor: UomActor, code: string, name: string, decimalPlaces = 0) {
  return createUom({ actor, code, name, decimalPlaces, correlationId: CORR });
}

/** Define the garment set for a tenant and return the unit ids by code. */
async function seedUnits(actor: UomActor) {
  const pcs = await makeUom(actor, "PCS", "Pieces");
  const pack = await makeUom(actor, "PACK", "Pack");
  const dozen = await makeUom(actor, "DOZEN", "Dozen");
  const carton = await makeUom(actor, "CARTON", "Carton");
  if (
    pcs.status !== "ok" ||
    pack.status !== "ok" ||
    dozen.status !== "ok" ||
    carton.status !== "ok"
  ) {
    throw new Error("unit setup failed");
  }

  for (const [from, factor] of [
    [pack.uom.id, 6],
    [dozen.uom.id, 12],
    [carton.uom.id, 24],
  ] as const) {
    const created = await createUomConversion({
      actor,
      fromUomId: from,
      toUomId: pcs.uom.id,
      factor,
      correlationId: CORR,
    });
    if (created.status !== "ok") throw new Error(`conversion setup failed: ${created.status}`);
  }

  return { pcs: pcs.uom.id, pack: pack.uom.id, dozen: dozen.uom.id, carton: carton.uom.id };
}

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
});

afterAll(async () => {
  await resetDatabase();
});

describe("defining units", () => {
  it("creates PCS, PACK, DOZEN and CARTON", async () => {
    const units = await seedUnits(ownerA);
    const listed = await listUoms(IDS.tenantA);

    expect(listed.map((u) => u.code)).toEqual(["CARTON", "DOZEN", "PACK", "PCS"]);
    expect(Object.values(units).every(Boolean)).toBe(true);
  });

  it("uppercases the code, so pcs and PCS are one unit", async () => {
    const first = await makeUom(ownerA, "pcs", "Pieces");
    const second = await makeUom(ownerA, "PCS", "Pieces");

    expect(first.status === "ok" && first.uom.code).toBe("PCS");
    expect(second.status === "ok" && second.existing).toBe(true);
    expect(await db.uom.count({ where: { tenantId: IDS.tenantA } })).toBe(1);
  });

  it("returns the existing unit on a replayed create rather than failing", async () => {
    await makeUom(ownerA, "DOZEN", "Dozen");
    const again = await makeUom(ownerA, "DOZEN", "Dozen");
    expect(again.status === "ok" && again.existing).toBe(true);
  });

  it("two concurrent creates of the same code produce exactly one unit", async () => {
    // The unique index is the arbiter; the loser reports the winner's row.
    const [a, b] = await Promise.all([
      makeUom(ownerA, "CARTON", "Carton"),
      makeUom(ownerA, "CARTON", "Carton"),
    ]);

    expect([a.status, b.status]).toEqual(["ok", "ok"]);
    expect(await db.uom.count({ where: { tenantId: IDS.tenantA, code: "CARTON" } })).toBe(1);
  });

  it("rejects a code that is not a short symbol", async () => {
    expect((await makeUom(ownerA, "1PCS", "Pieces")).status).toBe("validation_error");
    expect((await makeUom(ownerA, "a very long unit code", "Pieces")).status).toBe(
      "validation_error",
    );
  });

  it("refuses a cashier — defining units is not a till operation", async () => {
    expect((await makeUom(cashierA, "PCS", "Pieces")).status).toBe("forbidden");
  });
});

describe("defining conversions", () => {
  it("stores one direction and rejects the reverse as already derivable", async () => {
    const u = await seedUnits(ownerA);
    const reverse = await createUomConversion({
      actor: ownerA,
      fromUomId: u.pcs,
      toUomId: u.dozen,
      factor: 12,
      correlationId: CORR,
    });

    expect(reverse.status).toBe("conflict");
    expect(await listUomConversions(IDS.tenantA)).toHaveLength(3);
  });

  it("replaying the same definition succeeds; a different factor is a conflict", async () => {
    const u = await seedUnits(ownerA);

    const same = await createUomConversion({
      actor: ownerA,
      fromUomId: u.dozen,
      toUomId: u.pcs,
      factor: 12,
      correlationId: CORR,
    });
    expect(same.status === "ok" && same.existing).toBe(true);

    const different = await createUomConversion({
      actor: ownerA,
      fromUomId: u.dozen,
      toUomId: u.pcs,
      factor: 13,
      correlationId: CORR,
    });
    expect(different.status).toBe("conflict");
  });

  it("two concurrent identical conversions produce exactly one row", async () => {
    const pcs = await makeUom(ownerA, "PCS", "Pieces");
    const dozen = await makeUom(ownerA, "DOZEN", "Dozen");
    if (pcs.status !== "ok" || dozen.status !== "ok") throw new Error("setup");

    const args = {
      actor: ownerA,
      fromUomId: dozen.uom.id,
      toUomId: pcs.uom.id,
      factor: 12,
      correlationId: CORR,
    };
    const [a, b] = await Promise.all([createUomConversion(args), createUomConversion(args)]);

    expect([a.status, b.status]).toEqual(["ok", "ok"]);
    expect(await db.uomConversion.count({ where: { tenantId: IDS.tenantA } })).toBe(1);
  });

  it("rejects a self-conversion", async () => {
    const pcs = await makeUom(ownerA, "PCS", "Pieces");
    if (pcs.status !== "ok") throw new Error("setup");

    const result = await createUomConversion({
      actor: ownerA,
      fromUomId: pcs.uom.id,
      toUomId: pcs.uom.id,
      factor: 2,
      correlationId: CORR,
    });
    expect(result.status).toBe("validation_error");
  });

  it("rejects invalid factors", async () => {
    const pcs = await makeUom(ownerA, "PCS", "Pieces");
    const dozen = await makeUom(ownerA, "DOZEN", "Dozen");
    if (pcs.status !== "ok" || dozen.status !== "ok") throw new Error("setup");

    for (const factor of [0, 1, -12, 1.5]) {
      const result = await createUomConversion({
        actor: ownerA,
        fromUomId: dozen.uom.id,
        toUomId: pcs.uom.id,
        factor,
        correlationId: CORR,
      });
      expect(result.status).toBe("validation_error");
    }
    expect(await db.uomConversion.count()).toBe(0);
  });
});

describe("resolving conversions through the service", () => {
  it("converts down, up and across", async () => {
    const u = await seedUnits(ownerA);

    const down = await resolveConversion({
      tenantId: IDS.tenantA,
      quantity: 2,
      fromUomId: u.dozen,
      toUomId: u.pcs,
    });
    const up = await resolveConversion({
      tenantId: IDS.tenantA,
      quantity: 24,
      fromUomId: u.pcs,
      toUomId: u.dozen,
    });
    const across = await resolveConversion({
      tenantId: IDS.tenantA,
      quantity: 4,
      fromUomId: u.carton,
      toUomId: u.dozen,
    });

    expect(down.status === "ok" && down.quantity).toBe(24);
    expect(up.status === "ok" && up.quantity).toBe(2);
    expect(across.status === "ok" && across.quantity).toBe(8);
  });

  it("refuses a quantity that does not divide evenly", async () => {
    const u = await seedUnits(ownerA);
    const result = await resolveConversion({
      tenantId: IDS.tenantA,
      quantity: 13,
      fromUomId: u.pcs,
      toUomId: u.dozen,
    });

    expect(result.status).toBe("not_exact");
    if (result.status === "not_exact") expect(result.remainder).toBe(1);
  });
});

describe("tenant isolation", () => {
  it("a tenant sees only its own units", async () => {
    await seedUnits(ownerA);
    await makeUom(ownerB, "PCS", "Pieces");

    expect(await listUoms(IDS.tenantA)).toHaveLength(4);
    expect(await listUoms(IDS.tenantB)).toHaveLength(1);
  });

  it("two tenants may both define PCS without colliding", async () => {
    const a = await makeUom(ownerA, "PCS", "Pieces");
    const b = await makeUom(ownerB, "PCS", "Pieces");

    expect(a.status === "ok" && b.status === "ok").toBe(true);
    expect(a.status === "ok" && b.status === "ok" && a.uom.id !== b.uom.id).toBe(true);
  });

  it("a conversion cannot reference another tenant's unit", async () => {
    const u = await seedUnits(ownerA);
    const bPcs = await makeUom(ownerB, "PCS", "Pieces");
    if (bPcs.status !== "ok") throw new Error("setup");

    const result = await createUomConversion({
      actor: ownerA,
      fromUomId: u.dozen,
      toUomId: bPcs.uom.id,
      factor: 12,
      correlationId: CORR,
    });

    // Indistinguishable from a unit that does not exist — no cross-tenant existence oracle.
    expect(result.status).toBe("not_found");
  });

  it("resolving against another tenant's unit reports not found", async () => {
    const u = await seedUnits(ownerA);
    const result = await resolveConversion({
      tenantId: IDS.tenantB,
      quantity: 1,
      fromUomId: u.dozen,
      toUomId: u.pcs,
    });
    expect(result.status).toBe("not_found");
  });

  it("PostgreSQL rejects a conversion whose unit belongs to another tenant", async () => {
    // The composite foreign keys, not the application guard. Every id is individually valid.
    const u = await seedUnits(ownerA);
    const bPcs = await makeUom(ownerB, "PCS", "Pieces");
    if (bPcs.status !== "ok") throw new Error("setup");

    await expect(
      db.uomConversion.create({
        data: { tenantId: IDS.tenantA, fromUomId: u.dozen, toUomId: bPcs.uom.id, factor: 12 },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("PostgreSQL rejects a product based on another tenant's unit", async () => {
    const bPcs = await makeUom(ownerB, "PCS", "Pieces");
    if (bPcs.status !== "ok") throw new Error("setup");

    await expect(
      db.product.update({
        where: { id: COMMERCE_IDS.productA },
        data: { baseUomId: bPcs.uom.id },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});

describe("product base unit", () => {
  it("assigns a tenant's own unit to a product", async () => {
    const u = await seedUnits(ownerA);
    const result = await assignProductBaseUom({
      actor: ownerA,
      productId: COMMERCE_IDS.productA,
      uomId: u.pcs,
      correlationId: CORR,
    });

    expect(result.status).toBe("ok");
    const product = await db.product.findUniqueOrThrow({ where: { id: COMMERCE_IDS.productA } });
    expect(product.baseUomId).toBe(u.pcs);
  });

  it("refuses another tenant's product", async () => {
    const u = await seedUnits(ownerA);
    const result = await assignProductBaseUom({
      actor: ownerA,
      productId: COMMERCE_IDS.productB,
      uomId: u.pcs,
      correlationId: CORR,
    });
    expect(result.status).toBe("not_found");
  });

  it("refuses a unit that allows decimals, because quantities are whole numbers", async () => {
    const metre = await makeUom(ownerA, "METRE", "Metre", 3);
    if (metre.status !== "ok") throw new Error("setup");

    const result = await assignProductBaseUom({
      actor: ownerA,
      productId: COMMERCE_IDS.productA,
      uomId: metre.uom.id,
      correlationId: CORR,
    });

    expect(result.status).toBe("validation_error");
    const product = await db.product.findUniqueOrThrow({ where: { id: COMMERCE_IDS.productA } });
    expect(product.baseUomId).toBeNull();
  });

  it("refuses a cashier", async () => {
    const u = await seedUnits(ownerA);
    const result = await assignProductBaseUom({
      actor: cashierA,
      productId: COMMERCE_IDS.productA,
      uomId: u.pcs,
      correlationId: CORR,
    });
    expect(result.status).toBe("forbidden");
  });
});

describe("regression: nothing about quantities changed", () => {
  it("a product with no base unit still sells", async () => {
    // The fixture products have no baseUomId — the column is nullable precisely so that
    // introducing units cannot break a catalogue that predates them.
    const product = await db.product.findUniqueOrThrow({ where: { id: COMMERCE_IDS.productA } });
    expect(product.baseUomId).toBeNull();

    const sale = await createSale({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      cashierUserId: IDS.ownerA,
      idempotencyKey: `uom-regression-${Date.now()}`,
      lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 2 }],
      payment: { method: "CASH" },
      correlationId: "corr-sale",
    });

    expect(sale.status).toBe("ok");
  });

  it("a product with a base unit sells identically", async () => {
    const u = await seedUnits(ownerA);
    await assignProductBaseUom({
      actor: ownerA,
      productId: COMMERCE_IDS.productA,
      uomId: u.pcs,
      correlationId: CORR,
    });

    const sale = await createSale({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      cashierUserId: IDS.ownerA,
      idempotencyKey: `uom-regression-based-${Date.now()}`,
      lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 3 }],
      payment: { method: "CASH" },
      correlationId: "corr-sale",
    });

    expect(sale.status).toBe("ok");
    const level = await db.stockLevel.findUniqueOrThrow({
      where: { storeId_variantId: { storeId: IDS.storeA, variantId: COMMERCE_IDS.variantA1 } },
    });
    // Seeded 10, sold 3. Still counted in base units, still an integer.
    expect(level.quantity).toBe(7);
  });

  it("the stock ledger and its projection still reconcile after unit work", async () => {
    const u = await seedUnits(ownerA);
    await assignProductBaseUom({
      actor: ownerA,
      productId: COMMERCE_IDS.productA,
      uomId: u.pcs,
      correlationId: CORR,
    });
    await receiveStock({
      actor: { tenantId: IDS.tenantA, userId: IDS.ownerA, tenantRole: "OWNER" },
      storeId: IDS.storeA,
      variantId: COMMERCE_IDS.variantA1,
      quantity: 24,
      requestKey: `uom-recv-${Date.now()}`,
      correlationId: "corr-inventory",
    });

    expect(await findProjectionMismatches(db)).toEqual([]);
  });

  it("quantity columns are still integers, not decimals", async () => {
    // The boundary this phase must not cross, asserted against the live schema rather than
    // trusted to review.
    const columns = await db.$queryRaw<{ table_name: string; data_type: string }[]>`
      SELECT table_name, data_type
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (
           (table_name = 'sale_items'      AND column_name = 'quantity')      OR
           (table_name = 'stock_levels'    AND column_name = 'quantity')      OR
           (table_name = 'stock_movements' AND column_name = 'quantityDelta')
         )
    `;

    expect(columns).toHaveLength(3);
    for (const column of columns) {
      expect(column.data_type).toBe("integer");
    }
  });
});
