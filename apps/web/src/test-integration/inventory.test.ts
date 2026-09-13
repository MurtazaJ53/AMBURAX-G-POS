import { describe, expect, it, beforeEach, afterAll } from "vitest";
import {
  db,
  resetDatabase,
  seedTwoTenants,
  seedCommerce,
  IDS,
  COMMERCE_IDS,
  SEEDED_STOCK,
} from "./db";
import {
  receiveStock,
  adjustStock,
  recordStockTake,
  listStockMovements,
  type InventoryActor,
} from "@/server/inventory/inventoryService";
import { applyStockMovement, findProjectionMismatches } from "@/server/inventory/stockLedger";
import { createSale } from "@/server/sales/saleService";

/**
 * The inventory foundation against REAL PostgreSQL.
 *
 * This is the file that justifies the design, for the same reason the outbox has one: mocked
 * Prisma cannot lose an update, cannot roll back, and cannot hold a row lock. The properties
 * that matter here — that concurrent movements all land, that a failed transaction leaves
 * nothing behind, that the projection always equals the sum of the ledger — are only
 * demonstrable against a real server.
 */

const ownerA: InventoryActor = { tenantId: IDS.tenantA, userId: IDS.ownerA, tenantRole: "OWNER" };
const ownerB: InventoryActor = { tenantId: IDS.tenantB, userId: IDS.ownerB, tenantRole: "OWNER" };
const staffA: InventoryActor = { tenantId: IDS.tenantA, userId: IDS.staffA, tenantRole: "STAFF" };

let keySeq = 0;
/** A fresh request key per call, so tests do not accidentally exercise idempotency. */
function key(prefix = "req"): string {
  keySeq += 1;
  return `${prefix}-key-${keySeq}-${Date.now()}`;
}

function receipt(quantity: number, over: Partial<Parameters<typeof receiveStock>[0]> = {}) {
  return receiveStock({
    actor: ownerA,
    storeId: IDS.storeA,
    variantId: COMMERCE_IDS.variantA1,
    quantity,
    requestKey: key("recv"),
    correlationId: "corr-inventory",
    ...over,
  });
}

async function levelOf(storeId: string, variantId: string): Promise<number | null> {
  const level = await db.stockLevel.findUnique({
    where: { storeId_variantId: { storeId, variantId } },
    select: { quantity: true },
  });
  return level?.quantity ?? null;
}

/**
 * Empty one variant's stock completely, for the handful of cases that are about a balance
 * that has never existed. The shared fixture seeds stock (and its opening movement), which is
 * the realistic state; these cases need the other one.
 */
async function clearStockFor(storeId: string, variantId: string): Promise<void> {
  await db.stockMovement.deleteMany({ where: { storeId, variantId } });
  await db.stockLevel.deleteMany({ where: { storeId, variantId } });
}

/** The invariant, asked of the database rather than assumed. */
async function expectProjectionIntact(): Promise<void> {
  expect(await findProjectionMismatches(db)).toEqual([]);
}

beforeEach(async () => {
  keySeq = 0;
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
});

afterAll(async () => {
  await resetDatabase();
  await db.$disconnect();
});

describe("inbound stock — the operation that did not exist before P1-8B", () => {
  it("creates the balance from nothing and records why", async () => {
    // Before this phase no code path in the entire system could raise a stock level. The sale
    // decrement was the only writer.
    await clearStockFor(IDS.storeA, COMMERCE_IDS.variantA1);
    expect(await levelOf(IDS.storeA, COMMERCE_IDS.variantA1)).toBeNull();

    const result = await receipt(12);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.balanceAfter).toBe(12);
    expect(result.duplicate).toBe(false);
    expect(await levelOf(IDS.storeA, COMMERCE_IDS.variantA1)).toBe(12);

    const movements = await listStockMovements({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      variantId: COMMERCE_IDS.variantA1,
    });
    expect(movements).toHaveLength(1);
    expect(movements[0]!.type).toBe("RECEIPT");
    expect(movements[0]!.quantityDelta).toBe(12);
    expect(movements[0]!.balanceAfter).toBe(12);
    expect(movements[0]!.actorUserId).toBe(IDS.ownerA);
    await expectProjectionIntact();
  });

  it("adds to an existing balance rather than replacing it", async () => {
    await receipt(10);
    const second = await receipt(5);

    const expected = SEEDED_STOCK.variantA1 + 15;
    expect(second.status === "ok" && second.balanceAfter).toBe(expected);
    expect(await levelOf(IDS.storeA, COMMERCE_IDS.variantA1)).toBe(expected);
    await expectProjectionIntact();
  });

  it("writes an audit row naming the actor and the resulting balance", async () => {
    await receipt(7);
    const audit = await db.auditLog.findFirst({ where: { action: "StockReceived" } });
    expect(audit?.userId).toBe(IDS.ownerA);
    expect(audit?.tenantId).toBe(IDS.tenantA);
    expect(JSON.stringify(audit?.metadata)).toContain(
      `"balanceAfter":${SEEDED_STOCK.variantA1 + 7}`,
    );
  });

  it("rejects a quantity that is not a whole number", async () => {
    const result = await receipt(1.5);
    expect(result.status).toBe("invalid_quantity");
    // Nothing moved: the balance is exactly what the fixture seeded.
    expect(await levelOf(IDS.storeA, COMMERCE_IDS.variantA1)).toBe(SEEDED_STOCK.variantA1);
  });

  it("rejects zero — receiving nothing is not an event", async () => {
    const result = await receipt(0);
    expect(result.status).toBe("invalid_quantity");
  });

  it("rejects a quantity beyond the movement ceiling", async () => {
    const result = await receipt(1_000_001);
    expect(result.status).toBe("invalid_quantity");
    if (result.status === "invalid_quantity") expect(result.reason).toBe("too_large");
  });

  it("accepts the boundary quantity exactly", async () => {
    const result = await receipt(1_000_000);
    expect(result.status === "ok" && result.balanceAfter).toBe(SEEDED_STOCK.variantA1 + 1_000_000);
    await expectProjectionIntact();
  });
});

describe("idempotent retry", () => {
  it("a replayed request key does not receive the goods twice", async () => {
    const requestKey = key("dupe");
    const first = await receipt(20, { requestKey });
    const second = await receipt(20, { requestKey });

    expect(first.status === "ok" && first.duplicate).toBe(false);
    expect(second.status === "ok" && second.duplicate).toBe(true);
    const expected = SEEDED_STOCK.variantA1 + 20;
    expect(second.status === "ok" && second.balanceAfter).toBe(expected);

    // The decisive assertion: the balance moved once, and there is one movement, not two.
    expect(await levelOf(IDS.storeA, COMMERCE_IDS.variantA1)).toBe(expected);
    expect(await db.stockMovement.count({ where: { type: "RECEIPT" } })).toBe(1);
    await expectProjectionIntact();
  });

  it("two simultaneous retries of the same key still apply exactly once", async () => {
    // The pre-check both requests run will miss for both of them; only the unique index can
    // decide. The loser must return the winner's result, not an error.
    const requestKey = key("race");
    const [a, b] = await Promise.all([receipt(9, { requestKey }), receipt(9, { requestKey })]);

    expect([a.status, b.status]).toEqual(["ok", "ok"]);
    expect(await levelOf(IDS.storeA, COMMERCE_IDS.variantA1)).toBe(SEEDED_STOCK.variantA1 + 9);
    expect(await db.stockMovement.count({ where: { type: "RECEIPT" } })).toBe(1);
    await expectProjectionIntact();
  });

  it("the same request key means different things to different operations", async () => {
    const shared = key("shared");
    await receipt(10, { requestKey: shared });
    const adjusted = await adjustStock({
      actor: ownerA,
      storeId: IDS.storeA,
      variantId: COMMERCE_IDS.variantA1,
      quantityDelta: -3,
      reason: "Damaged in the stockroom",
      requestKey: shared,
      correlationId: "corr-inventory",
    });

    // Namespaced keys: the adjustment is not mistaken for a replay of the receipt.
    expect(adjusted.status === "ok" && adjusted.duplicate).toBe(false);
    expect(await levelOf(IDS.storeA, COMMERCE_IDS.variantA1)).toBe(SEEDED_STOCK.variantA1 + 7);
  });
});

describe("adjustment", () => {
  it("writes stock off with a stated reason", async () => {
    await receipt(30);
    const result = await adjustStock({
      actor: ownerA,
      storeId: IDS.storeA,
      variantId: COMMERCE_IDS.variantA1,
      quantityDelta: -4,
      reason: "Water damage",
      requestKey: key("adj"),
      correlationId: "corr-inventory",
    });

    expect(result.status === "ok" && result.balanceAfter).toBe(SEEDED_STOCK.variantA1 + 26);
    const movement = await db.stockMovement.findFirst({ where: { type: "ADJUSTMENT" } });
    expect(movement?.reason).toBe("Water damage");
    await expectProjectionIntact();
  });

  it("refuses an adjustment with no explanation", async () => {
    await receipt(30);
    const result = await adjustStock({
      actor: ownerA,
      storeId: IDS.storeA,
      variantId: COMMERCE_IDS.variantA1,
      quantityDelta: -4,
      reason: "  ",
      requestKey: key("adj"),
      correlationId: "corr-inventory",
    });

    expect(result.status).toBe("validation_error");
    expect(await levelOf(IDS.storeA, COMMERCE_IDS.variantA1)).toBe(SEEDED_STOCK.variantA1 + 30);
  });

  it("allows a balance to go negative rather than clamping it", async () => {
    // Signed on purpose: clamping would hide exactly the drift a reconciliation sweep exists
    // to find, and the schema comment says so.
    await receipt(2);
    const result = await adjustStock({
      actor: ownerA,
      storeId: IDS.storeA,
      variantId: COMMERCE_IDS.variantA1,
      quantityDelta: -(SEEDED_STOCK.variantA1 + 5),
      reason: "Counted short after a spill",
      requestKey: key("adj"),
      correlationId: "corr-inventory",
    });

    expect(result.status === "ok" && result.balanceAfter).toBe(-3);
    await expectProjectionIntact();
  });
});

describe("stock take", () => {
  it("records the difference between the count and the system", async () => {
    await receipt(20);
    const result = await recordStockTake({
      actor: ownerA,
      storeId: IDS.storeA,
      variantId: COMMERCE_IDS.variantA1,
      countedQuantity: 18,
      requestKey: key("count"),
      correlationId: "corr-inventory",
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.delta).toBe(-(SEEDED_STOCK.variantA1 + 2));
    expect(result.balanceAfter).toBe(18);
    await expectProjectionIntact();
  });

  it("writes nothing when the count agrees with the system", async () => {
    await receipt(20);
    const result = await recordStockTake({
      actor: ownerA,
      storeId: IDS.storeA,
      variantId: COMMERCE_IDS.variantA1,
      countedQuantity: SEEDED_STOCK.variantA1 + 20,
      requestKey: key("count"),
      correlationId: "corr-inventory",
    });

    expect(result.status === "ok" && result.delta).toBe(0);
    expect(result.status === "ok" && result.movementId).toBeNull();
    // A zero-delta row would bury real corrections in noise.
    expect(await db.stockMovement.count({ where: { type: "STOCK_TAKE" } })).toBe(0);
  });

  it("counts a variant that has never been stocked", async () => {
    await clearStockFor(IDS.storeA, COMMERCE_IDS.variantA1);
    const result = await recordStockTake({
      actor: ownerA,
      storeId: IDS.storeA,
      variantId: COMMERCE_IDS.variantA1,
      countedQuantity: 6,
      requestKey: key("count"),
      correlationId: "corr-inventory",
    });

    expect(result.status === "ok" && result.delta).toBe(6);
    expect(await levelOf(IDS.storeA, COMMERCE_IDS.variantA1)).toBe(6);
    await expectProjectionIntact();
  });

  it("rejects a negative count — you cannot count minus three shirts", async () => {
    const result = await recordStockTake({
      actor: ownerA,
      storeId: IDS.storeA,
      variantId: COMMERCE_IDS.variantA1,
      countedQuantity: -3,
      requestKey: key("count"),
      correlationId: "corr-inventory",
    });
    expect(result.status).toBe("validation_error");
  });
});

describe("authorization", () => {
  it("refuses a staff user with no membership at the store", async () => {
    const result = await receipt(5, { actor: staffA });
    expect(result.status).toBe("forbidden");
    expect(await levelOf(IDS.storeA, COMMERCE_IDS.variantA1)).toBe(SEEDED_STOCK.variantA1);
  });

  it("refuses a cashier — selling is not the same authority as receiving", async () => {
    await db.storeMembership.create({
      data: { tenantId: IDS.tenantA, userId: IDS.staffA, storeId: IDS.storeA, role: "CASHIER" },
    });
    const result = await receipt(5, { actor: staffA });
    expect(result.status).toBe("forbidden");
  });

  it("admits an inventory manager", async () => {
    await db.storeMembership.create({
      data: {
        tenantId: IDS.tenantA,
        userId: IDS.staffA,
        storeId: IDS.storeA,
        role: "INVENTORY_MANAGER",
      },
    });
    const result = await receipt(5, { actor: staffA });
    expect(result.status === "ok" && result.balanceAfter).toBe(SEEDED_STOCK.variantA1 + 5);
  });
});

describe("tenant isolation", () => {
  it("tenant A cannot receive stock into tenant B's store", async () => {
    const result = await receipt(5, { storeId: IDS.storeB });

    // Indistinguishable from a store that does not exist — no cross-tenant existence oracle.
    expect(result.status).toBe("not_found");
    if (result.status === "not_found") expect(result.what).toBe("store");
    expect(await levelOf(IDS.storeB, COMMERCE_IDS.variantA1)).toBeNull();
  });

  it("tenant A cannot receive tenant B's product into its own store", async () => {
    const result = await receipt(5, { variantId: COMMERCE_IDS.variantB1 });
    expect(result.status).toBe("not_found");
    if (result.status === "not_found") expect(result.what).toBe("variant");
  });

  it("tenant B's own receipt is unaffected by tenant A's activity", async () => {
    await receipt(11);
    const bResult = await receiveStock({
      actor: ownerB,
      storeId: IDS.storeB,
      variantId: COMMERCE_IDS.variantB1,
      quantity: 4,
      requestKey: key("b-recv"),
      correlationId: "corr-inventory",
    });

    expect(bResult.status === "ok" && bResult.balanceAfter).toBe(SEEDED_STOCK.variantB1 + 4);
    expect(await levelOf(IDS.storeA, COMMERCE_IDS.variantA1)).toBe(SEEDED_STOCK.variantA1 + 11);
    await expectProjectionIntact();
  });

  it("PostgreSQL rejects a movement whose store belongs to another tenant", async () => {
    // The composite foreign keys, not the application guard. Every id here is individually
    // valid; only the combination is wrong.
    await expect(
      db.$transaction((tx) =>
        applyStockMovement(tx, {
          tenantId: IDS.tenantA,
          storeId: IDS.storeB,
          variantId: COMMERCE_IDS.variantA1,
          type: "RECEIPT",
          quantityDelta: 5,
          idempotencyKey: "cross-tenant-store",
        }),
      ),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("PostgreSQL rejects a movement whose variant belongs to another tenant", async () => {
    await expect(
      db.$transaction((tx) =>
        applyStockMovement(tx, {
          tenantId: IDS.tenantA,
          storeId: IDS.storeA,
          variantId: COMMERCE_IDS.variantB1,
          type: "RECEIPT",
          quantityDelta: 5,
          idempotencyKey: "cross-tenant-variant",
        }),
      ),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("an idempotency key is scoped per tenant, so two tenants may reuse the same one", async () => {
    await receipt(3, { requestKey: "shared-across-tenants" });
    const bResult = await receiveStock({
      actor: ownerB,
      storeId: IDS.storeB,
      variantId: COMMERCE_IDS.variantB1,
      quantity: 3,
      requestKey: "shared-across-tenants",
      correlationId: "corr-inventory",
    });

    expect(bResult.status === "ok" && bResult.duplicate).toBe(false);
  });
});

describe("concurrency — the properties only a real database can demonstrate", () => {
  it("ten simultaneous receipts all land; not one update is lost", async () => {
    // The classic lost-update test. Read-modify-write in application code would produce
    // something less than 100 here; `quantity = quantity + delta` computed by PostgreSQL under
    // a row lock produces exactly 100.
    const results = await Promise.all(Array.from({ length: 10 }, () => receipt(10)));

    expect(results.every((r) => r.status === "ok")).toBe(true);
    expect(await levelOf(IDS.storeA, COMMERCE_IDS.variantA1)).toBe(SEEDED_STOCK.variantA1 + 100);
    expect(await db.stockMovement.count({ where: { type: "RECEIPT" } })).toBe(10);
    await expectProjectionIntact();
  });

  it("concurrent receipts and adjustments interleave without losing either", async () => {
    await receipt(50);

    await Promise.all([
      receipt(10),
      receipt(10),
      adjustStock({
        actor: ownerA,
        storeId: IDS.storeA,
        variantId: COMMERCE_IDS.variantA1,
        quantityDelta: -5,
        reason: "Damaged unit",
        requestKey: key("adj"),
        correlationId: "corr-inventory",
      }),
      adjustStock({
        actor: ownerA,
        storeId: IDS.storeA,
        variantId: COMMERCE_IDS.variantA1,
        quantityDelta: -5,
        reason: "Second damaged unit",
        requestKey: key("adj"),
        correlationId: "corr-inventory",
      }),
    ]);

    expect(await levelOf(IDS.storeA, COMMERCE_IDS.variantA1)).toBe(SEEDED_STOCK.variantA1 + 60);
    await expectProjectionIntact();
  });

  it("two first-ever movements for the same variant cannot both create the level", async () => {
    // The upsert race: both transactions find no row. `INSERT ... ON CONFLICT DO UPDATE` means
    // the loser updates instead of failing on the unique index.
    await db.stockMovement.deleteMany({});
    await db.stockLevel.deleteMany({});
    const [a, b] = await Promise.all([receipt(4), receipt(6)]);

    expect([a.status, b.status]).toEqual(["ok", "ok"]);
    expect(await levelOf(IDS.storeA, COMMERCE_IDS.variantA1)).toBe(10);
    expect(await db.stockLevel.count()).toBe(1);
    await expectProjectionIntact();
  });
});

describe("transaction rollback", () => {
  it("a failed transaction leaves neither a movement nor a balance change", async () => {
    await receipt(25);

    await expect(
      db.$transaction(async (tx) => {
        await applyStockMovement(tx, {
          tenantId: IDS.tenantA,
          storeId: IDS.storeA,
          variantId: COMMERCE_IDS.variantA1,
          type: "RECEIPT",
          quantityDelta: 100,
          idempotencyKey: key("rollback"),
        });
        throw new Error("caller failed after the movement");
      }),
    ).rejects.toThrow("caller failed after the movement");

    // Both halves rolled back together — this is why the ledger takes a transaction client and
    // cannot be called with the global one.
    expect(await levelOf(IDS.storeA, COMMERCE_IDS.variantA1)).toBe(SEEDED_STOCK.variantA1 + 25);
    expect(await db.stockMovement.count({ where: { quantityDelta: 100 } })).toBe(0);
    await expectProjectionIntact();
  });
});

describe("the POS sale still decrements stock, and now explains it", () => {
  async function sell(quantity: number) {
    return createSale({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      cashierUserId: IDS.ownerA,
      idempotencyKey: key("sale"),
      lines: [{ variantId: COMMERCE_IDS.variantA1, quantity }],
      payment: { method: "CASH" },
      correlationId: "corr-sale",
    });
  }

  it("decrements exactly as before", async () => {
    await receipt(10);
    const sale = await sell(3);

    expect(sale.status).toBe("ok");
    expect(await levelOf(IDS.storeA, COMMERCE_IDS.variantA1)).toBe(SEEDED_STOCK.variantA1 + 7);
    await expectProjectionIntact();
  });

  it("leaves a SALE movement pointing back at the sale", async () => {
    await receipt(10);
    const sale = await sell(2);
    if (sale.status !== "ok") throw new Error("sale failed");

    const movement = await db.stockMovement.findFirst({ where: { type: "SALE" } });
    expect(movement?.quantityDelta).toBe(-2);
    expect(movement?.referenceType).toBe("SALE");
    expect(movement?.referenceId).toBe(sale.sale.id);
    expect(movement?.balanceAfter).toBe(SEEDED_STOCK.variantA1 + 8);
  });

  it("selling from an empty store drives the balance negative rather than failing", async () => {
    // Unchanged behaviour, asserted so the ledger cannot quietly introduce an oversell guard
    // the POS never had. Whether to block overselling is a product decision, not a side effect
    // of this phase.
    await clearStockFor(IDS.storeA, COMMERCE_IDS.variantA1);
    const sale = await sell(4);
    expect(sale.status).toBe("ok");
    expect(await levelOf(IDS.storeA, COMMERCE_IDS.variantA1)).toBe(-4);
    await expectProjectionIntact();
  });

  it("a replayed sale does not decrement twice", async () => {
    await receipt(10);
    const idempotencyKey = key("sale-dupe");
    const args = {
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      cashierUserId: IDS.ownerA,
      idempotencyKey,
      lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 3 }],
      payment: { method: "CASH" as const },
      correlationId: "corr-sale",
    };

    const first = await createSale(args);
    const second = await createSale(args);

    expect(first.status === "ok" && first.duplicate).toBe(false);
    expect(second.status === "ok" && second.duplicate).toBe(true);
    expect(await levelOf(IDS.storeA, COMMERCE_IDS.variantA1)).toBe(SEEDED_STOCK.variantA1 + 7);
    expect(await db.stockMovement.count({ where: { type: "SALE" } })).toBe(1);
    await expectProjectionIntact();
  });

  it("a multi-line sale writes one movement per line", async () => {
    await receipt(10);
    await receipt(10, { variantId: COMMERCE_IDS.variantA2 });

    const sale = await createSale({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      cashierUserId: IDS.ownerA,
      idempotencyKey: key("multi"),
      lines: [
        { variantId: COMMERCE_IDS.variantA1, quantity: 2 },
        { variantId: COMMERCE_IDS.variantA2, quantity: 3 },
      ],
      payment: { method: "CASH" },
      correlationId: "corr-sale",
    });

    expect(sale.status).toBe("ok");
    expect(await db.stockMovement.count({ where: { type: "SALE" } })).toBe(2);
    expect(await levelOf(IDS.storeA, COMMERCE_IDS.variantA1)).toBe(SEEDED_STOCK.variantA1 + 8);
    expect(await levelOf(IDS.storeA, COMMERCE_IDS.variantA2)).toBe(SEEDED_STOCK.variantA2 + 7);
    await expectProjectionIntact();
  });
});

describe("the projection invariant itself", () => {
  it("holds for the seeded opening balances before anything else happens", async () => {
    // The fixture writes a stock level and the OPENING_BALANCE movement that explains it, the
    // same shape the migration produced for real data. A fixture that skipped the movement
    // would seed a state the system can no longer produce.
    await expectProjectionIntact();
    expect(await db.stockMovement.count({ where: { type: "OPENING_BALANCE" } })).toBe(3);
  });


  it("holds across a long mixed sequence of operations", async () => {
    await receipt(100);
    await adjustStock({
      actor: ownerA,
      storeId: IDS.storeA,
      variantId: COMMERCE_IDS.variantA1,
      quantityDelta: -7,
      reason: "Shrinkage",
      requestKey: key("adj"),
      correlationId: "corr-inventory",
    });
    await createSale({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      cashierUserId: IDS.ownerA,
      idempotencyKey: key("sale"),
      lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 5 }],
      payment: { method: "CASH" },
      correlationId: "corr-sale",
    });
    await recordStockTake({
      actor: ownerA,
      storeId: IDS.storeA,
      variantId: COMMERCE_IDS.variantA1,
      countedQuantity: 90,
      requestKey: key("count"),
      correlationId: "corr-inventory",
    });
    await receipt(10);

    // The stock take normalises the balance to the counted 90 whatever came before, so this
    // total does not depend on the fixture's opening quantity.
    expect(await levelOf(IDS.storeA, COMMERCE_IDS.variantA1)).toBe(100);
    await expectProjectionIntact();
  });

  it("detects a mismatch when a balance is tampered with outside the ledger", async () => {
    // Proves the check is capable of failing. A reconciliation sweep that can only return
    // "fine" is not a check.
    await receipt(10);
    await db.$executeRaw`UPDATE "stock_levels" SET "quantity" = 999 WHERE "variantId" = ${COMMERCE_IDS.variantA1}`;

    const mismatches = await findProjectionMismatches(db, IDS.tenantA);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]!.levelQuantity).toBe(999);
    expect(mismatches[0]!.movementSum).toBe(SEEDED_STOCK.variantA1 + 10);
  });
});
