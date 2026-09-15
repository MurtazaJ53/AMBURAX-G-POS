import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { OrderStatus } from "@prisma/client";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS } from "./db";
import { createUom } from "@/server/uom/uomService";
import {
  createPriceList,
  setPriceListItem,
  assignCustomerPriceList,
} from "@/server/pricing/pricingService";
import {
  cancelOrder,
  closeOrder,
  confirmOrder,
  createOrder,
  getOrder,
  listOrders,
  recordFulfilment,
  transitionOrder,
  updateDraftOrder,
  type OrderActor,
} from "@/server/orders/orderService";
import { createSale } from "@/server/sales/saleService";

/**
 * Orders against real PostgreSQL.
 *
 * What is worth proving here cannot be proven against a mock: composite foreign keys that refuse
 * a cross-tenant pairing, a unique index that refuses a duplicate line, an optimistic version
 * that makes two simultaneous confirmations resolve to one winner, and the fact that none of
 * this writes a stock movement.
 */

const CORR = "corr-orders";

const ownerA: OrderActor = {
  tenantId: IDS.tenantA,
  userId: IDS.ownerA,
  tenantRole: "OWNER",
  membershipRole: "OWNER",
};
const staffA: OrderActor = {
  tenantId: IDS.tenantA,
  userId: IDS.staffA,
  tenantRole: "STAFF",
  membershipRole: null,
};
const ownerB: OrderActor = {
  tenantId: IDS.tenantB,
  userId: IDS.ownerB,
  tenantRole: "OWNER",
  membershipRole: "OWNER",
};

let pcsA = "";
let pcsB = "";

beforeAll(async () => {
  await db.$connect();
});

afterAll(async () => {
  await db.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();

  const a = await createUom({
    actor: {
      tenantId: IDS.tenantA,
      userId: IDS.ownerA,
      tenantRole: "OWNER",
      membershipRole: "OWNER",
    },
    code: "PCS",
    name: "Pieces",
    correlationId: CORR,
  });
  if (a.status !== "ok") throw new Error(`uom A setup failed: ${a.status}`);
  pcsA = a.uom.id;

  const b = await createUom({
    actor: {
      tenantId: IDS.tenantB,
      userId: IDS.ownerB,
      tenantRole: "OWNER",
      membershipRole: "OWNER",
    },
    code: "PCS",
    name: "Pieces",
    correlationId: CORR,
  });
  if (b.status !== "ok") throw new Error(`uom B setup failed: ${b.status}`);
  pcsB = b.uom.id;
});

function draft(overrides: Partial<Parameters<typeof createOrder>[0]> = {}) {
  return createOrder({
    actor: ownerA,
    storeId: IDS.storeA,
    lines: [{ variantId: COMMERCE_IDS.variantA1, uomId: pcsA, quantity: 2 }],
    idempotencyKey: `key-${Math.random().toString(36).slice(2)}-0000`,
    correlationId: CORR,
    ...overrides,
  });
}

async function draftOrThrow(overrides: Partial<Parameters<typeof createOrder>[0]> = {}) {
  const result = await draft(overrides);
  if (result.status !== "ok") throw new Error(`draft setup failed: ${JSON.stringify(result)}`);
  return result.order;
}

// ---------------------------------------------------------------------------------------------
// Model and CRUD
// ---------------------------------------------------------------------------------------------

describe("creating an order", () => {
  it("creates a DRAFT with a readable number and server-priced lines", async () => {
    const result = await draft();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    expect(result.order.status).toBe(OrderStatus.DRAFT);
    expect(result.order.orderNumber).toBe("SA-SO-000001");
    expect(result.order.currency).toBe("INR");
    expect(result.order.items).toHaveLength(1);
    // Variant A1's base price is 100000 minor units; two of them.
    expect(result.order.items[0]!.unitPriceMinor).toBe(100_000);
    expect(result.order.items[0]!.lineTotalMinor).toBe(200_000);
    expect(result.order.subtotalMinor).toBe(200_000);
  });

  it("numbers orders sequentially per store, without touching the bill sequence", async () => {
    const first = await draftOrThrow();
    const second = await draftOrThrow();

    expect(first.orderNumber).toBe("SA-SO-000001");
    expect(second.orderNumber).toBe("SA-SO-000002");

    const store = await db.store.findUniqueOrThrow({ where: { id: IDS.storeA } });
    expect(store.nextBillSeq).toBe(1);
    expect(store.nextOrderSeq).toBe(3);
  });

  it("allows a walk-in order with no customer", async () => {
    const order = await draftOrThrow({ customerId: null });
    expect(order.customerId).toBeNull();
  });

  it("records the customer when one is given", async () => {
    const order = await draftOrThrow({ customerId: COMMERCE_IDS.customerA });
    expect(order.customerId).toBe(COMMERCE_IDS.customerA);
  });

  it("snapshots the sku, product name and unit code onto each line", async () => {
    const order = await draftOrThrow();
    expect(order.items[0]!.skuSnapshot).toBe("A-SHIRT-M");
    expect(order.items[0]!.nameSnapshot).toBeTruthy();
    expect(order.items[0]!.uomCodeSnapshot).toBe("PCS");
  });

  it("refuses an empty order", async () => {
    const result = await draft({ lines: [] });
    expect(result.status).toBe("validation_error");
  });

  it("refuses the same variant and unit twice in one order", async () => {
    const result = await draft({
      lines: [
        { variantId: COMMERCE_IDS.variantA1, uomId: pcsA, quantity: 1 },
        { variantId: COMMERCE_IDS.variantA1, uomId: pcsA, quantity: 2 },
      ],
    });
    expect(result.status).toBe("validation_error");
  });

  it("refuses a user who may not sell", async () => {
    const result = await draft({ actor: staffA });
    expect(result).toEqual({ status: "forbidden" });
  });

  it("writes an audit entry", async () => {
    const order = await draftOrThrow();
    const entry = await db.auditLog.findFirst({
      where: { tenantId: IDS.tenantA, action: "OrderCreated" },
    });
    expect(entry).not.toBeNull();
    expect(entry?.metadata).toMatchObject({ orderId: order.id });
  });
});

describe("reading orders", () => {
  it("returns one order by id", async () => {
    const created = await draftOrThrow();
    const result = await getOrder({ actor: ownerA, orderId: created.id });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.order.id).toBe(created.id);
  });

  it("lists the tenant's orders, newest first", async () => {
    await draftOrThrow();
    await draftOrThrow();
    const orders = await listOrders({ tenantId: IDS.tenantA });
    expect(orders).toHaveLength(2);
    expect(orders[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(orders[1]!.createdAt.getTime());
  });

  it("filters by status", async () => {
    const a = await draftOrThrow();
    await draftOrThrow();
    await confirmOrder({ actor: ownerA, orderId: a.id, correlationId: CORR });

    const confirmed = await listOrders({ tenantId: IDS.tenantA, status: OrderStatus.CONFIRMED });
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]!.id).toBe(a.id);
  });

  it("reports a nonexistent order as not found", async () => {
    const result = await getOrder({ actor: ownerA, orderId: "does-not-exist" });
    expect(result).toEqual({ status: "not_found", what: "order" });
  });
});

describe("editing a draft", () => {
  it("replaces the lines and recomputes the subtotal", async () => {
    const order = await draftOrThrow();
    const result = await updateDraftOrder({
      actor: ownerA,
      orderId: order.id,
      lines: [{ variantId: COMMERCE_IDS.variantA2, uomId: pcsA, quantity: 3 }],
      correlationId: CORR,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.order.items).toHaveLength(1);
    expect(result.order.items[0]!.variantId).toBe(COMMERCE_IDS.variantA2);
    // Variant A2's base price is 200000.
    expect(result.order.subtotalMinor).toBe(600_000);
  });

  /** Everything past DRAFT is a commitment, and a commitment that can be rewritten is not one. */
  it("refuses to edit a confirmed order", async () => {
    const order = await draftOrThrow();
    await confirmOrder({ actor: ownerA, orderId: order.id, correlationId: CORR });

    const result = await updateDraftOrder({
      actor: ownerA,
      orderId: order.id,
      lines: [{ variantId: COMMERCE_IDS.variantA2, uomId: pcsA, quantity: 1 }],
      correlationId: CORR,
    });
    expect(result.status).toBe("conflict");
  });

  it("refuses a stale expectedVersion rather than overwriting someone else's edit", async () => {
    const order = await draftOrThrow();
    await updateDraftOrder({
      actor: ownerA,
      orderId: order.id,
      lines: [{ variantId: COMMERCE_IDS.variantA2, uomId: pcsA, quantity: 1 }],
      correlationId: CORR,
    });

    const stale = await updateDraftOrder({
      actor: ownerA,
      orderId: order.id,
      lines: [{ variantId: COMMERCE_IDS.variantA1, uomId: pcsA, quantity: 9 }],
      expectedVersion: order.version,
      correlationId: CORR,
    });
    expect(stale.status).toBe("conflict");
  });
});

// ---------------------------------------------------------------------------------------------
// Status machine
// ---------------------------------------------------------------------------------------------

describe("the status machine", () => {
  it("confirms a draft", async () => {
    const order = await draftOrThrow();
    const result = await confirmOrder({ actor: ownerA, orderId: order.id, correlationId: CORR });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.order.status).toBe(OrderStatus.CONFIRMED);
    expect(result.order.confirmedAt).not.toBeNull();
    expect(result.order.version).toBe(order.version + 1);
  });

  it("refuses to confirm an already-confirmed order", async () => {
    const order = await draftOrThrow();
    await confirmOrder({ actor: ownerA, orderId: order.id, correlationId: CORR });
    const again = await confirmOrder({ actor: ownerA, orderId: order.id, correlationId: CORR });
    expect(again.status).toBe("invalid_transition");
  });

  it("cancels a draft with a reason", async () => {
    const order = await draftOrThrow();
    const result = await cancelOrder({
      actor: ownerA,
      orderId: order.id,
      reason: "Customer changed their mind",
      correlationId: CORR,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.order.status).toBe(OrderStatus.CANCELLED);
    expect(result.order.cancellationReason).toBe("Customer changed their mind");
    expect(result.order.cancelledAt).not.toBeNull();
  });

  /** An unexplained cancellation is indistinguishable from a mistake. */
  it("refuses to cancel without a reason", async () => {
    const order = await draftOrThrow();
    const result = await cancelOrder({
      actor: ownerA,
      orderId: order.id,
      reason: "  ",
      correlationId: CORR,
    });
    expect(result.status).toBe("validation_error");
  });

  it("cancels a confirmed order", async () => {
    const order = await draftOrThrow();
    await confirmOrder({ actor: ownerA, orderId: order.id, correlationId: CORR });
    const result = await cancelOrder({
      actor: ownerA,
      orderId: order.id,
      reason: "Out of stock",
      correlationId: CORR,
    });
    expect(result.status).toBe("ok");
  });

  it("refuses to cancel a partially fulfilled order", async () => {
    const order = await draftOrThrow();
    await confirmOrder({ actor: ownerA, orderId: order.id, correlationId: CORR });
    const confirmed = await getOrder({ actor: ownerA, orderId: order.id });
    if (confirmed.status !== "ok") return;

    await recordFulfilment({
      actor: ownerA,
      orderId: order.id,
      lines: [{ orderItemId: confirmed.order.items[0]!.id, quantity: 1 }],
      correlationId: CORR,
    });

    const result = await cancelOrder({
      actor: ownerA,
      orderId: order.id,
      reason: "Too late",
      correlationId: CORR,
    });
    expect(result.status).toBe("invalid_transition");
  });

  it("closes a fulfilled order", async () => {
    const order = await draftOrThrow();
    await confirmOrder({ actor: ownerA, orderId: order.id, correlationId: CORR });
    const confirmed = await getOrder({ actor: ownerA, orderId: order.id });
    if (confirmed.status !== "ok") return;

    await recordFulfilment({
      actor: ownerA,
      orderId: order.id,
      lines: [{ orderItemId: confirmed.order.items[0]!.id, quantity: 2 }],
      correlationId: CORR,
    });

    const result = await closeOrder({ actor: ownerA, orderId: order.id, correlationId: CORR });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.order.status).toBe(OrderStatus.CLOSED);
    expect(result.order.closedAt).not.toBeNull();
  });

  it("refuses to close an order that is not fulfilled", async () => {
    const order = await draftOrThrow();
    await confirmOrder({ actor: ownerA, orderId: order.id, correlationId: CORR });
    const result = await closeOrder({ actor: ownerA, orderId: order.id, correlationId: CORR });
    expect(result.status).toBe("invalid_transition");
  });

  /** A closed order is finished, in every direction. */
  it("refuses every mutation of a closed order", async () => {
    const order = await draftOrThrow();
    await confirmOrder({ actor: ownerA, orderId: order.id, correlationId: CORR });
    const confirmed = await getOrder({ actor: ownerA, orderId: order.id });
    if (confirmed.status !== "ok") return;
    await recordFulfilment({
      actor: ownerA,
      orderId: order.id,
      lines: [{ orderItemId: confirmed.order.items[0]!.id, quantity: 2 }],
      correlationId: CORR,
    });
    await closeOrder({ actor: ownerA, orderId: order.id, correlationId: CORR });

    expect(
      (await confirmOrder({ actor: ownerA, orderId: order.id, correlationId: CORR })).status,
    ).toBe("invalid_transition");
    expect(
      (
        await cancelOrder({
          actor: ownerA,
          orderId: order.id,
          reason: "Never mind",
          correlationId: CORR,
        })
      ).status,
    ).toBe("invalid_transition");
    expect(
      (await closeOrder({ actor: ownerA, orderId: order.id, correlationId: CORR })).status,
    ).toBe("invalid_transition");
    expect(
      (
        await updateDraftOrder({
          actor: ownerA,
          orderId: order.id,
          lines: [{ variantId: COMMERCE_IDS.variantA1, uomId: pcsA, quantity: 1 }],
          correlationId: CORR,
        })
      ).status,
    ).toBe("conflict");
    expect(
      (
        await recordFulfilment({
          actor: ownerA,
          orderId: order.id,
          lines: [{ orderItemId: confirmed.order.items[0]!.id, quantity: 1 }],
          correlationId: CORR,
        })
      ).status,
    ).toBe("invalid_transition");

    const final = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(final.status).toBe(OrderStatus.CLOSED);
  });

  it("refuses a status transition for a user who may not sell", async () => {
    const order = await draftOrThrow();
    const result = await confirmOrder({ actor: staffA, orderId: order.id, correlationId: CORR });
    expect(result).toEqual({ status: "forbidden" });
  });
});

// ---------------------------------------------------------------------------------------------
// RESERVED
// ---------------------------------------------------------------------------------------------

describe("RESERVED is refused, honestly", () => {
  /**
   * The phase's most important behaviour. Nothing in this system reserves stock, so an order
   * must not be able to claim that it has.
   */
  it("refuses a transition to RESERVED with its own distinct reason", async () => {
    const order = await draftOrThrow();
    await confirmOrder({ actor: ownerA, orderId: order.id, correlationId: CORR });

    const result = await transitionOrder({
      actor: ownerA,
      orderId: order.id,
      to: OrderStatus.RESERVED,
      correlationId: CORR,
    });
    expect(result).toEqual({ status: "reservation_unavailable" });

    const unchanged = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(unchanged.status).toBe(OrderStatus.CONFIRMED);
  });

  it("leaves no order in RESERVED anywhere, ever", async () => {
    const order = await draftOrThrow();
    await confirmOrder({ actor: ownerA, orderId: order.id, correlationId: CORR });
    await transitionOrder({
      actor: ownerA,
      orderId: order.id,
      to: OrderStatus.RESERVED,
      correlationId: CORR,
    });

    const reserved = await db.order.count({ where: { status: OrderStatus.RESERVED } });
    expect(reserved).toBe(0);
  });

  /** And the reason it is refused: there is no reservation accounting to back it. */
  it("has no reservation movement type in the inventory ledger", async () => {
    const values = await db.$queryRaw<{ enumlabel: string }[]>`
      SELECT e.enumlabel FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'StockMovementType'
    `;
    const labels = values.map((v) => v.enumlabel);
    expect(labels.length).toBeGreaterThan(0);
    expect(labels).not.toContain("RESERVATION");
    expect(labels).not.toContain("RESERVE");
  });
});

describe("the transition entry point refuses to set derived statuses", () => {
  it("will not let a caller name PARTIALLY_FULFILLED", async () => {
    const order = await draftOrThrow();
    await confirmOrder({ actor: ownerA, orderId: order.id, correlationId: CORR });

    const result = await transitionOrder({
      actor: ownerA,
      orderId: order.id,
      to: OrderStatus.PARTIALLY_FULFILLED,
      correlationId: CORR,
    });
    expect(result.status).toBe("validation_error");
  });

  it("will not let a caller name FULFILLED", async () => {
    const order = await draftOrThrow();
    await confirmOrder({ actor: ownerA, orderId: order.id, correlationId: CORR });

    const result = await transitionOrder({
      actor: ownerA,
      orderId: order.id,
      to: OrderStatus.FULFILLED,
      correlationId: CORR,
    });
    expect(result.status).toBe("validation_error");
  });
});

// ---------------------------------------------------------------------------------------------
// Fulfilment quantity accounting
// ---------------------------------------------------------------------------------------------

describe("recording fulfilment", () => {
  async function confirmedWithTwoLines() {
    const created = await draftOrThrow({
      lines: [
        { variantId: COMMERCE_IDS.variantA1, uomId: pcsA, quantity: 2 },
        { variantId: COMMERCE_IDS.variantA2, uomId: pcsA, quantity: 3 },
      ],
    });
    const confirmed = await confirmOrder({
      actor: ownerA,
      orderId: created.id,
      correlationId: CORR,
    });
    if (confirmed.status !== "ok") throw new Error("confirm setup failed");
    return confirmed.order;
  }

  it("moves to PARTIALLY_FULFILLED when some of the demand is met", async () => {
    const order = await confirmedWithTwoLines();
    const result = await recordFulfilment({
      actor: ownerA,
      orderId: order.id,
      lines: [{ orderItemId: order.items[0]!.id, quantity: 1 }],
      correlationId: CORR,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.order.status).toBe(OrderStatus.PARTIALLY_FULFILLED);
  });

  it("moves to FULFILLED only when every line is complete", async () => {
    const order = await confirmedWithTwoLines();

    await recordFulfilment({
      actor: ownerA,
      orderId: order.id,
      lines: [{ orderItemId: order.items[0]!.id, quantity: 2 }],
      correlationId: CORR,
    });
    const midway = await getOrder({ actor: ownerA, orderId: order.id });
    if (midway.status !== "ok") return;
    expect(midway.order.status).toBe(OrderStatus.PARTIALLY_FULFILLED);

    const result = await recordFulfilment({
      actor: ownerA,
      orderId: order.id,
      lines: [{ orderItemId: order.items[1]!.id, quantity: 3 }],
      correlationId: CORR,
    });
    if (result.status !== "ok") return;
    expect(result.order.status).toBe(OrderStatus.FULFILLED);
  });

  it("refuses more than was ordered", async () => {
    const order = await confirmedWithTwoLines();
    const result = await recordFulfilment({
      actor: ownerA,
      orderId: order.id,
      lines: [{ orderItemId: order.items[0]!.id, quantity: 99 }],
      correlationId: CORR,
    });
    expect(result.status).toBe("validation_error");
  });

  it("refuses recording against a draft", async () => {
    const order = await draftOrThrow();
    const result = await recordFulfilment({
      actor: ownerA,
      orderId: order.id,
      lines: [{ orderItemId: order.items[0]!.id, quantity: 1 }],
      correlationId: CORR,
    });
    expect(result.status).toBe("invalid_transition");
  });

  /**
   * The line that keeps this phase honest: fulfilment here is quantity accounting and moves no
   * stock at all. The ledger is still the only authority on what is on a shelf.
   */
  it("writes no stock movement and changes no stock level", async () => {
    const before = await db.stockMovement.count({ where: { tenantId: IDS.tenantA } });
    const levelsBefore = await db.stockLevel.findMany({
      where: { tenantId: IDS.tenantA },
      orderBy: { variantId: "asc" },
      select: { variantId: true, quantity: true },
    });

    const order = await confirmedWithTwoLines();
    await recordFulfilment({
      actor: ownerA,
      orderId: order.id,
      lines: [{ orderItemId: order.items[0]!.id, quantity: 2 }],
      correlationId: CORR,
    });

    expect(await db.stockMovement.count({ where: { tenantId: IDS.tenantA } })).toBe(before);
    const levelsAfter = await db.stockLevel.findMany({
      where: { tenantId: IDS.tenantA },
      orderBy: { variantId: "asc" },
      select: { variantId: true, quantity: true },
    });
    expect(levelsAfter).toEqual(levelsBefore);
  });
});

describe("orders never touch inventory", () => {
  it("creates no stock movement when an order is created, confirmed or cancelled", async () => {
    const before = await db.stockMovement.count({ where: { tenantId: IDS.tenantA } });

    const order = await draftOrThrow();
    await confirmOrder({ actor: ownerA, orderId: order.id, correlationId: CORR });
    await cancelOrder({
      actor: ownerA,
      orderId: order.id,
      reason: "Testing",
      correlationId: CORR,
    });

    expect(await db.stockMovement.count({ where: { tenantId: IDS.tenantA } })).toBe(before);
  });

  it("creates no sale", async () => {
    const before = await db.sale.count({ where: { tenantId: IDS.tenantA } });
    const order = await draftOrThrow();
    await confirmOrder({ actor: ownerA, orderId: order.id, correlationId: CORR });
    expect(await db.sale.count({ where: { tenantId: IDS.tenantA } })).toBe(before);
  });
});

// ---------------------------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------------------------

describe("pricing is resolved by the server", () => {
  it("uses the variant's base price when no price list applies", async () => {
    const order = await draftOrThrow();
    expect(order.items[0]!.unitPriceMinor).toBe(100_000);
    expect(order.items[0]!.priceSourceSnapshot).toBe("VARIANT_BASE");
  });

  it("uses the customer's negotiated price list", async () => {
    const list = await createPriceList({
      actor: ownerA,
      name: "Trade",
      currency: "INR",
      correlationId: CORR,
    });
    if (list.status !== "ok") throw new Error("list setup failed");

    await setPriceListItem({
      actor: ownerA,
      priceListId: list.priceList.id,
      variantId: COMMERCE_IDS.variantA1,
      uomId: pcsA,
      minQuantity: 1,
      unitPriceMinor: 80_000,
      correlationId: CORR,
    });
    await assignCustomerPriceList({
      actor: ownerA,
      customerId: COMMERCE_IDS.customerA,
      priceListId: list.priceList.id,
      correlationId: CORR,
    });

    const order = await draftOrThrow({ customerId: COMMERCE_IDS.customerA });
    expect(order.items[0]!.unitPriceMinor).toBe(80_000);
    expect(order.items[0]!.priceSourceSnapshot).toBe("CUSTOMER_LIST");
    expect(order.items[0]!.priceListIdSnapshot).toBe(list.priceList.id);
  });

  it("applies quantity breaks", async () => {
    const list = await createPriceList({
      actor: ownerA,
      name: "Bulk",
      currency: "INR",
      correlationId: CORR,
    });
    if (list.status !== "ok") throw new Error("list setup failed");

    for (const [minQuantity, price] of [
      [1, 100_000],
      [10, 90_000],
      [50, 75_000],
    ] as const) {
      await setPriceListItem({
        actor: ownerA,
        priceListId: list.priceList.id,
        variantId: COMMERCE_IDS.variantA1,
        uomId: pcsA,
        minQuantity,
        unitPriceMinor: price,
        correlationId: CORR,
      });
    }
    await assignCustomerPriceList({
      actor: ownerA,
      customerId: COMMERCE_IDS.customerA,
      priceListId: list.priceList.id,
      correlationId: CORR,
    });

    const small = await draftOrThrow({
      customerId: COMMERCE_IDS.customerA,
      lines: [{ variantId: COMMERCE_IDS.variantA1, uomId: pcsA, quantity: 9 }],
    });
    expect(small.items[0]!.unitPriceMinor).toBe(100_000);

    const medium = await draftOrThrow({
      customerId: COMMERCE_IDS.customerA,
      lines: [{ variantId: COMMERCE_IDS.variantA1, uomId: pcsA, quantity: 10 }],
    });
    expect(medium.items[0]!.unitPriceMinor).toBe(90_000);

    const large = await draftOrThrow({
      customerId: COMMERCE_IDS.customerA,
      lines: [{ variantId: COMMERCE_IDS.variantA1, uomId: pcsA, quantity: 50 }],
    });
    expect(large.items[0]!.unitPriceMinor).toBe(75_000);
  });

  /**
   * There is no price field in the input type at all. A client cannot override what it cannot
   * express — this test smuggles one in anyway and proves it is ignored.
   */
  it("ignores a price a client tries to smuggle in", async () => {
    const result = await createOrder({
      actor: ownerA,
      storeId: IDS.storeA,
      lines: [
        {
          variantId: COMMERCE_IDS.variantA1,
          uomId: pcsA,
          quantity: 2,
          unitPriceMinor: 1,
          lineTotalMinor: 2,
          subtotalMinor: 2,
        } as never,
      ],
      idempotencyKey: "smuggled-price-key-0001",
      correlationId: CORR,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.order.items[0]!.unitPriceMinor).toBe(100_000);
    expect(result.order.subtotalMinor).toBe(200_000);
  });

  it("re-resolves and locks the price at confirmation", async () => {
    const list = await createPriceList({
      actor: ownerA,
      name: "Trade",
      currency: "INR",
      correlationId: CORR,
    });
    if (list.status !== "ok") throw new Error("list setup failed");
    await assignCustomerPriceList({
      actor: ownerA,
      customerId: COMMERCE_IDS.customerA,
      priceListId: list.priceList.id,
      correlationId: CORR,
    });

    // Drafted at the base price, because the list carries nothing for this variant yet.
    const order = await draftOrThrow({ customerId: COMMERCE_IDS.customerA });
    expect(order.items[0]!.unitPriceMinor).toBe(100_000);

    await setPriceListItem({
      actor: ownerA,
      priceListId: list.priceList.id,
      variantId: COMMERCE_IDS.variantA1,
      uomId: pcsA,
      minQuantity: 1,
      unitPriceMinor: 70_000,
      correlationId: CORR,
    });

    const confirmed = await confirmOrder({
      actor: ownerA,
      orderId: order.id,
      correlationId: CORR,
    });
    if (confirmed.status !== "ok") return;
    expect(confirmed.order.items[0]!.unitPriceMinor).toBe(70_000);
    expect(confirmed.order.subtotalMinor).toBe(140_000);
  });

  /** The agreement survives the price list changing underneath it. */
  it("keeps a confirmed order's price stable when the price list is edited afterwards", async () => {
    const list = await createPriceList({
      actor: ownerA,
      name: "Trade",
      currency: "INR",
      correlationId: CORR,
    });
    if (list.status !== "ok") throw new Error("list setup failed");
    await setPriceListItem({
      actor: ownerA,
      priceListId: list.priceList.id,
      variantId: COMMERCE_IDS.variantA1,
      uomId: pcsA,
      minQuantity: 1,
      unitPriceMinor: 80_000,
      correlationId: CORR,
    });
    await assignCustomerPriceList({
      actor: ownerA,
      customerId: COMMERCE_IDS.customerA,
      priceListId: list.priceList.id,
      correlationId: CORR,
    });

    const order = await draftOrThrow({ customerId: COMMERCE_IDS.customerA });
    await confirmOrder({ actor: ownerA, orderId: order.id, correlationId: CORR });

    // The merchant raises the price after the order was agreed.
    await db.priceListItem.updateMany({
      where: { priceListId: list.priceList.id, variantId: COMMERCE_IDS.variantA1 },
      data: { unitPriceMinor: 999_000 },
    });

    const reread = await getOrder({ actor: ownerA, orderId: order.id });
    if (reread.status !== "ok") return;
    expect(reread.order.items[0]!.unitPriceMinor).toBe(80_000);
    expect(reread.order.subtotalMinor).toBe(160_000);
  });

  /** And the catalogue changing underneath it. */
  it("keeps the sku and name snapshots stable when the product is renamed", async () => {
    const order = await draftOrThrow();
    await confirmOrder({ actor: ownerA, orderId: order.id, correlationId: CORR });

    await db.product.updateMany({
      where: { tenantId: IDS.tenantA },
      data: { name: "Renamed Later" },
    });
    await db.productVariant.updateMany({
      where: { id: COMMERCE_IDS.variantA1 },
      data: { sku: "CHANGED-SKU" },
    });

    const reread = await getOrder({ actor: ownerA, orderId: order.id });
    if (reread.status !== "ok") return;
    expect(reread.order.items[0]!.skuSnapshot).toBe("A-SHIRT-M");
    expect(reread.order.items[0]!.nameSnapshot).not.toBe("Renamed Later");
  });
});

// ---------------------------------------------------------------------------------------------
// Address snapshot
// ---------------------------------------------------------------------------------------------

describe("address snapshots", () => {
  async function giveCustomerAnAddress() {
    const address = await db.address.create({
      data: {
        tenantId: IDS.tenantA,
        line1: "12 Linking Road",
        city: "Mumbai",
        state: "MH",
        postalCode: "400050",
        country: "IN",
        contactName: "Asha",
        contactPhone: "+910000000009",
        type: "SHIPPING",
      },
    });
    await db.customer.update({
      where: { id: COMMERCE_IDS.customerA },
      data: { defaultShippingAddressId: address.id, defaultBillingAddressId: address.id },
    });
    return address;
  }

  it("copies the customer's addresses onto the order at confirmation", async () => {
    await giveCustomerAnAddress();
    const order = await draftOrThrow({ customerId: COMMERCE_IDS.customerA });

    // A draft has no snapshot yet — nothing has been committed to.
    expect(order.addresses).toHaveLength(0);

    const confirmed = await confirmOrder({
      actor: ownerA,
      orderId: order.id,
      correlationId: CORR,
    });
    if (confirmed.status !== "ok") return;

    expect(confirmed.order.addresses).toHaveLength(2);
    const shipping = confirmed.order.addresses.find((a) => a.type === "SHIPPING");
    expect(shipping?.line1).toBe("12 Linking Road");
    expect(shipping?.city).toBe("Mumbai");
  });

  /**
   * The whole point of a snapshot, and the rule ADDRESS.md wrote down before orders existed:
   * editing a customer's address must never rewrite where something was already sent.
   */
  it("does not change when the customer's address is edited afterwards", async () => {
    const address = await giveCustomerAnAddress();
    const order = await draftOrThrow({ customerId: COMMERCE_IDS.customerA });
    await confirmOrder({ actor: ownerA, orderId: order.id, correlationId: CORR });

    await db.address.update({
      where: { id: address.id },
      data: { line1: "99 Somewhere Else", city: "Pune" },
    });

    const reread = await getOrder({ actor: ownerA, orderId: order.id });
    if (reread.status !== "ok") return;
    const shipping = reread.order.addresses.find((a) => a.type === "SHIPPING");
    expect(shipping?.line1).toBe("12 Linking Road");
    expect(shipping?.city).toBe("Mumbai");
  });

  it("survives the source address being deactivated", async () => {
    const address = await giveCustomerAnAddress();
    const order = await draftOrThrow({ customerId: COMMERCE_IDS.customerA });
    await confirmOrder({ actor: ownerA, orderId: order.id, correlationId: CORR });

    await db.address.update({ where: { id: address.id }, data: { isActive: false } });

    const reread = await getOrder({ actor: ownerA, orderId: order.id });
    if (reread.status !== "ok") return;
    expect(reread.order.addresses).toHaveLength(2);
  });

  it("leaves a walk-in order with no address snapshot rather than inventing one", async () => {
    const order = await draftOrThrow({ customerId: null });
    const confirmed = await confirmOrder({
      actor: ownerA,
      orderId: order.id,
      correlationId: CORR,
    });
    if (confirmed.status !== "ok") return;
    expect(confirmed.order.addresses).toHaveLength(0);
  });

  it("refuses a second address of the same type at the database level", async () => {
    await giveCustomerAnAddress();
    const order = await draftOrThrow({ customerId: COMMERCE_IDS.customerA });
    await confirmOrder({ actor: ownerA, orderId: order.id, correlationId: CORR });

    await expect(
      db.orderAddress.create({
        data: {
          tenantId: IDS.tenantA,
          orderId: order.id,
          type: "SHIPPING",
          line1: "Another",
          city: "Delhi",
          state: "DL",
          postalCode: "110001",
          country: "IN",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

// ---------------------------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------------------------

describe("tenant isolation", () => {
  async function tenantBOrder(key: string) {
    const result = await createOrder({
      actor: ownerB,
      storeId: IDS.storeB,
      lines: [{ variantId: COMMERCE_IDS.variantB1, uomId: pcsB, quantity: 1 }],
      idempotencyKey: key,
      correlationId: CORR,
    });
    if (result.status !== "ok") throw new Error("tenant B order setup failed");
    return result.order;
  }

  it("does not let tenant A read tenant B's order", async () => {
    const bOrder = await tenantBOrder("tenant-b-key-000001");
    const result = await getOrder({ actor: ownerA, orderId: bOrder.id });
    expect(result).toEqual({ status: "not_found", what: "order" });
  });

  /** A foreign order is indistinguishable from one that never existed. */
  it("answers a foreign order and a nonexistent order identically", async () => {
    const bOrder = await tenantBOrder("tenant-b-key-000002");
    const foreign = await getOrder({ actor: ownerA, orderId: bOrder.id });
    const missing = await getOrder({ actor: ownerA, orderId: "no-such-order-at-all" });
    expect(foreign).toEqual(missing);
  });

  it("lists only the tenant's own orders", async () => {
    await draftOrThrow();
    await tenantBOrder("tenant-b-key-000003");

    const aOrders = await listOrders({ tenantId: IDS.tenantA });
    expect(aOrders).toHaveLength(1);
    for (const order of aOrders) {
      const row = await db.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(row.tenantId).toBe(IDS.tenantA);
    }
  });

  it("refuses tenant B's customer", async () => {
    const result = await draft({ customerId: COMMERCE_IDS.customerB });
    expect(result).toEqual({ status: "not_found", what: "customer" });
  });

  it("refuses tenant B's store", async () => {
    const result = await draft({ storeId: IDS.storeB });
    expect(result).toEqual({ status: "not_found", what: "store" });
  });

  it("refuses tenant B's variant", async () => {
    const result = await draft({
      lines: [{ variantId: COMMERCE_IDS.variantB1, uomId: pcsA, quantity: 1 }],
    });
    expect(result).toEqual({ status: "not_found", what: "variant" });
  });

  it("refuses tenant B's unit", async () => {
    const result = await draft({
      lines: [{ variantId: COMMERCE_IDS.variantA1, uomId: pcsB, quantity: 1 }],
    });
    expect(result).toEqual({ status: "not_found", what: "uom" });
  });

  it("does not let tenant B transition tenant A's order", async () => {
    const order = await draftOrThrow();
    const result = await confirmOrder({ actor: ownerB, orderId: order.id, correlationId: CORR });
    expect(result).toEqual({ status: "not_found", what: "order" });

    const unchanged = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(unchanged.status).toBe(OrderStatus.DRAFT);
  });

  it("does not let tenant B edit tenant A's draft", async () => {
    const order = await draftOrThrow();
    const result = await updateDraftOrder({
      actor: ownerB,
      orderId: order.id,
      lines: [{ variantId: COMMERCE_IDS.variantB1, uomId: pcsB, quantity: 1 }],
      correlationId: CORR,
    });
    expect(result).toEqual({ status: "not_found", what: "order" });
  });

  it("does not let tenant B record fulfilment against tenant A's order", async () => {
    const order = await draftOrThrow();
    await confirmOrder({ actor: ownerA, orderId: order.id, correlationId: CORR });
    const confirmed = await getOrder({ actor: ownerA, orderId: order.id });
    if (confirmed.status !== "ok") return;

    const result = await recordFulfilment({
      actor: ownerB,
      orderId: order.id,
      lines: [{ orderItemId: confirmed.order.items[0]!.id, quantity: 1 }],
      correlationId: CORR,
    });
    expect(result).toEqual({ status: "not_found", what: "order" });
  });
});

describe("the database refuses cross-tenant orders", () => {
  /** Raw Prisma, bypassing every service. These are claims about PostgreSQL, not about code. */
  it("refuses an order whose store belongs to another tenant", async () => {
    await expect(
      db.order.create({
        data: {
          tenantId: IDS.tenantA,
          storeId: IDS.storeB,
          orderNumber: "X-SO-000001",
          currency: "INR",
          idempotencyKey: "raw-cross-store-1",
          createdByUserId: IDS.ownerA,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("refuses an order whose customer belongs to another tenant", async () => {
    await expect(
      db.order.create({
        data: {
          tenantId: IDS.tenantA,
          storeId: IDS.storeA,
          customerId: COMMERCE_IDS.customerB,
          orderNumber: "X-SO-000002",
          currency: "INR",
          idempotencyKey: "raw-cross-customer-1",
          createdByUserId: IDS.ownerA,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("refuses a line whose variant belongs to another tenant", async () => {
    const order = await draftOrThrow();
    await expect(
      db.orderItem.create({
        data: {
          tenantId: IDS.tenantA,
          orderId: order.id,
          variantId: COMMERCE_IDS.variantB1,
          uomId: pcsA,
          quantity: 1,
          unitPriceMinor: 1000,
          lineTotalMinor: 1000,
          skuSnapshot: "X",
          nameSnapshot: "X",
          uomCodeSnapshot: "PCS",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("refuses a line whose unit belongs to another tenant", async () => {
    const order = await draftOrThrow();
    await expect(
      db.orderItem.create({
        data: {
          tenantId: IDS.tenantA,
          orderId: order.id,
          variantId: COMMERCE_IDS.variantA1,
          uomId: pcsB,
          quantity: 1,
          unitPriceMinor: 1000,
          lineTotalMinor: 1000,
          skuSnapshot: "X",
          nameSnapshot: "X",
          uomCodeSnapshot: "PCS",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("refuses a line attached to another tenant's order", async () => {
    const order = await draftOrThrow();
    await expect(
      db.orderItem.create({
        data: {
          tenantId: IDS.tenantB,
          orderId: order.id,
          variantId: COMMERCE_IDS.variantB1,
          uomId: pcsB,
          quantity: 1,
          unitPriceMinor: 1000,
          lineTotalMinor: 1000,
          skuSnapshot: "X",
          nameSnapshot: "X",
          uomCodeSnapshot: "PCS",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("refuses an address snapshot sourced from another tenant's address", async () => {
    const order = await draftOrThrow();
    const foreignAddress = await db.address.create({
      data: {
        tenantId: IDS.tenantB,
        line1: "B Street",
        city: "Delhi",
        state: "DL",
        postalCode: "110001",
        country: "IN",
        type: "SHIPPING",
      },
    });

    await expect(
      db.orderAddress.create({
        data: {
          tenantId: IDS.tenantA,
          orderId: order.id,
          type: "SHIPPING",
          line1: "B Street",
          city: "Delhi",
          state: "DL",
          postalCode: "110001",
          country: "IN",
          sourceAddressId: foreignAddress.id,
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("refuses a duplicate line for the same variant and unit", async () => {
    const order = await draftOrThrow();
    await expect(
      db.orderItem.create({
        data: {
          tenantId: IDS.tenantA,
          orderId: order.id,
          variantId: COMMERCE_IDS.variantA1,
          uomId: pcsA,
          quantity: 1,
          unitPriceMinor: 1000,
          lineTotalMinor: 1000,
          skuSnapshot: "X",
          nameSnapshot: "X",
          uomCodeSnapshot: "PCS",
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

// ---------------------------------------------------------------------------------------------
// Idempotency and concurrency
// ---------------------------------------------------------------------------------------------

describe("idempotency", () => {
  it("returns the original order on a replayed create", async () => {
    const key = "replay-key-00000001";
    const first = await draft({ idempotencyKey: key });
    const second = await draft({ idempotencyKey: key });

    expect(first.status).toBe("ok");
    expect(second.status).toBe("ok");
    if (first.status !== "ok" || second.status !== "ok") return;

    expect(second.order.id).toBe(first.order.id);
    expect(second.duplicate).toBe(true);
    expect(await db.order.count({ where: { tenantId: IDS.tenantA } })).toBe(1);
  });

  it("lets two tenants use the same idempotency key independently", async () => {
    const key = "shared-key-00000001";
    await draft({ idempotencyKey: key });
    const b = await createOrder({
      actor: ownerB,
      storeId: IDS.storeB,
      lines: [{ variantId: COMMERCE_IDS.variantB1, uomId: pcsB, quantity: 1 }],
      idempotencyKey: key,
      correlationId: CORR,
    });
    expect(b.status).toBe("ok");
    expect(await db.order.count()).toBe(2);
  });

  it("creates exactly one order when the same key is submitted concurrently", async () => {
    const key = "concurrent-key-0001";
    const results = await Promise.all([
      draft({ idempotencyKey: key }),
      draft({ idempotencyKey: key }),
      draft({ idempotencyKey: key }),
    ]);

    for (const result of results) expect(result.status).toBe("ok");
    expect(await db.order.count({ where: { tenantId: IDS.tenantA } })).toBe(1);
  });
});

describe("concurrency", () => {
  /** The order-number counter is taken under the Store row lock, so numbers cannot collide. */
  it("issues distinct order numbers under concurrent creation", async () => {
    await Promise.all([
      draft({ idempotencyKey: "num-key-00000001" }),
      draft({ idempotencyKey: "num-key-00000002" }),
      draft({ idempotencyKey: "num-key-00000003" }),
      draft({ idempotencyKey: "num-key-00000004" }),
    ]);

    const orders = await db.order.findMany({
      where: { tenantId: IDS.tenantA },
      select: { orderNumber: true },
    });
    expect(orders).toHaveLength(4);
    expect(new Set(orders.map((o) => o.orderNumber)).size).toBe(4);
  });

  it("lets only one of two simultaneous confirmations win", async () => {
    const order = await draftOrThrow();

    const results = await Promise.all([
      confirmOrder({
        actor: ownerA,
        orderId: order.id,
        expectedVersion: order.version,
        correlationId: CORR,
      }),
      confirmOrder({
        actor: ownerA,
        orderId: order.id,
        expectedVersion: order.version,
        correlationId: CORR,
      }),
    ]);

    expect(results.filter((r) => r.status === "ok")).toHaveLength(1);

    const final = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(final.status).toBe(OrderStatus.CONFIRMED);
    expect(final.version).toBe(order.version + 1);
  });

  it("lets only one of a simultaneous confirm and cancel win", async () => {
    const order = await draftOrThrow();

    const results = await Promise.all([
      confirmOrder({
        actor: ownerA,
        orderId: order.id,
        expectedVersion: order.version,
        correlationId: CORR,
      }),
      cancelOrder({
        actor: ownerA,
        orderId: order.id,
        reason: "Changed mind",
        expectedVersion: order.version,
        correlationId: CORR,
      }),
    ]);

    expect(results.filter((r) => r.status === "ok")).toHaveLength(1);

    const final = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect([OrderStatus.CONFIRMED, OrderStatus.CANCELLED]).toContain(final.status);
    expect(final.version).toBe(order.version + 1);
  });

  it("does not let concurrent fulfilment records exceed what was ordered", async () => {
    const created = await draftOrThrow();
    const confirmed = await confirmOrder({
      actor: ownerA,
      orderId: created.id,
      correlationId: CORR,
    });
    if (confirmed.status !== "ok") return;

    const itemId = confirmed.order.items[0]!.id;
    await Promise.all([
      recordFulfilment({
        actor: ownerA,
        orderId: created.id,
        lines: [{ orderItemId: itemId, quantity: 2 }],
        expectedVersion: confirmed.order.version,
        correlationId: CORR,
      }),
      recordFulfilment({
        actor: ownerA,
        orderId: created.id,
        lines: [{ orderItemId: itemId, quantity: 2 }],
        expectedVersion: confirmed.order.version,
        correlationId: CORR,
      }),
    ]);

    const item = await db.orderItem.findFirstOrThrow({ where: { orderId: created.id } });
    expect(item.fulfilledQuantity).toBeLessThanOrEqual(item.quantity);
  });
});

// ---------------------------------------------------------------------------------------------
// Regression
// ---------------------------------------------------------------------------------------------

describe("existing behaviour is unchanged", () => {
  it("still completes a POS sale, with orders present", async () => {
    await draftOrThrow();

    const sale = await createSale({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      cashierUserId: IDS.ownerA,
      idempotencyKey: "sale-with-orders-1",
      lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 1 }],
      payment: { method: "CASH" },
      correlationId: CORR,
    });
    expect(sale.status).toBe("ok");
  });

  it("still decrements stock on a sale, and only on a sale", async () => {
    const before = await db.stockLevel.findFirstOrThrow({
      where: { tenantId: IDS.tenantA, variantId: COMMERCE_IDS.variantA1 },
    });

    const order = await draftOrThrow();
    await confirmOrder({ actor: ownerA, orderId: order.id, correlationId: CORR });

    const afterOrder = await db.stockLevel.findFirstOrThrow({
      where: { tenantId: IDS.tenantA, variantId: COMMERCE_IDS.variantA1 },
    });
    expect(afterOrder.quantity).toBe(before.quantity);

    await createSale({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      cashierUserId: IDS.ownerA,
      idempotencyKey: "sale-decrement-1",
      lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 1 }],
      payment: { method: "CASH" },
      correlationId: CORR,
    });

    const afterSale = await db.stockLevel.findFirstOrThrow({
      where: { tenantId: IDS.tenantA, variantId: COMMERCE_IDS.variantA1 },
    });
    expect(afterSale.quantity).toBe(before.quantity - 1);
  });

  it("keeps sale and order numbering independent", async () => {
    await draftOrThrow();
    const sale = await createSale({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      cashierUserId: IDS.ownerA,
      idempotencyKey: "sale-numbering-1",
      lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 1 }],
      payment: { method: "CASH" },
      correlationId: CORR,
    });
    if (sale.status !== "ok") return;

    expect(sale.sale.billNumber).toBe("SA-000001");
    const order = await db.order.findFirstOrThrow({ where: { tenantId: IDS.tenantA } });
    expect(order.orderNumber).toBe("SA-SO-000001");
  });

  /** An order is a shared foundation. Switching RETAIL off must not stop one being taken. */
  it("leaves orders ungated by capability", async () => {
    await db.tenantCapability.updateMany({
      where: { tenantId: IDS.tenantA },
      data: { enabled: false },
    });

    const result = await draft({ idempotencyKey: "no-capability-key-1" });
    expect(result.status).toBe("ok");
  });

  it("stores every order quantity and amount as an integer column", async () => {
    const columns = await db.$queryRaw<{ column_name: string; data_type: string }[]>`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name IN ('orders', 'order_items')
        AND column_name IN ('quantity', 'fulfilledQuantity', 'unitPriceMinor', 'lineTotalMinor', 'subtotalMinor')
    `;
    expect(columns.length).toBeGreaterThan(0);
    for (const column of columns) {
      expect(column.data_type).toBe("integer");
    }
  });
});
