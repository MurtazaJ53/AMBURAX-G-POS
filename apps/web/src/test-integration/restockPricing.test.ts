import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS, SEEDED_STOCK } from "./db";
import {
  receiveStock,
  adjustStock,
  type InventoryActor,
} from "@/server/inventory/inventoryService";
import { findProjectionMismatches } from "@/server/inventory/stockLedger";
import type { PriceChangeRequest } from "@/server/inventory/priceChanges";
import { createSale } from "@/server/sales/saleService";
import { updateVariant } from "@/server/catalog/catalogService";
import { FakeErpTransport } from "@/server/erp/fakeTransport";
import { ErpSaleAdapter } from "@/server/erp/saleAdapter";
import { ErpCatalogAdapter } from "@/server/erp/catalogAdapter";
import { ErpStoreAdapter } from "@/server/erp/storeAdapter";
import { ErpInventoryAdapter } from "@/server/erp/inventoryAdapter";
import { ErpOutboxPublisher } from "@/server/erp/outboxPublisher";
import { dispatchOutboxOnce } from "@/server/events/outboxDispatcher";

/**
 * Restocking at a new cost or a new selling price, end to end against real PostgreSQL.
 *
 * The fixture variant A1 sells at ₹1,000 (MRP ₹1,200) with 10 units on hand. Every case below
 * is a delivery of the same shirt arriving at a different price, and what that must do to the
 * units already on the shelf.
 */

const owner: InventoryActor = { tenantId: IDS.tenantA, userId: IDS.ownerA, tenantRole: "OWNER" };
const VARIANT = COMMERCE_IDS.variantA1;
const OLD_PRICE = 100_000;
const OLD_MRP = 120_000;

let seq = 0;
const key = (p: string) => `${p}-${++seq}-${Date.now()}`;

function restock(quantity: number, extra: { unitCostMinor?: number | null; pricing?: PriceChangeRequest | null } = {}) {
  return receiveStock({
    actor: owner,
    storeId: IDS.storeA,
    variantId: VARIANT,
    quantity,
    requestKey: key("recv"),
    correlationId: "corr-restock",
    ...extra,
  });
}

function sell(quantity: number) {
  return createSale({
    tenantId: IDS.tenantA,
    storeId: IDS.storeA,
    cashierUserId: IDS.ownerA,
    idempotencyKey: key("sale"),
    lines: [{ variantId: VARIANT, quantity }],
    payment: { method: "CASH" },
    correlationId: "corr-sale",
  });
}

async function price() {
  return db.productVariant.findUniqueOrThrow({
    where: { id: VARIANT },
    select: { priceMinor: true, mrpMinor: true },
  });
}

async function pending() {
  return db.pendingPriceChange.findMany({
    where: { tenantId: IDS.tenantA, variantId: VARIANT },
    orderBy: { createdAt: "asc" },
  });
}

async function priceEvents() {
  return db.outboxEvent.count({
    where: { tenantId: IDS.tenantA, eventType: "ProductVariantUpdated", entityId: VARIANT },
  });
}

const higher: PriceChangeRequest = { priceMinor: 119_900, mrpMinor: 139_900, policy: "after_older_stock" };

beforeEach(async () => {
  seq = 0;
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
});

afterAll(async () => {
  await resetDatabase();
});

describe("restock cost", () => {
  it("records what one unit of this delivery cost, and leaves the price alone", async () => {
    const result = await restock(20, { unitCostMinor: 65_000 });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    const movement = await db.stockMovement.findUniqueOrThrow({ where: { id: result.movementId } });
    expect(movement.unitCostMinor).toBe(65_000);
    expect(await price()).toEqual({ priceMinor: OLD_PRICE, mrpMinor: OLD_MRP });
    expect(await pending()).toHaveLength(0);
  });

  it("a receipt without a cost still works — cost is optional", async () => {
    const result = await restock(5);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    const movement = await db.stockMovement.findUniqueOrThrow({ where: { id: result.movementId } });
    expect(movement.unitCostMinor).toBeNull();
  });

  it("refuses a negative cost and writes nothing", async () => {
    const result = await restock(5, { unitCostMinor: -1 });
    expect(result.status).toBe("validation_error");
    expect(await db.stockMovement.count({ where: { type: "RECEIPT" } })).toBe(0);
  });

  it("the same price as today is not a price change", async () => {
    const result = await restock(5, { pricing: { priceMinor: OLD_PRICE, mrpMinor: OLD_MRP, policy: "now" } });
    expect(result.status).toBe("ok");
    expect(await price()).toEqual({ priceMinor: OLD_PRICE, mrpMinor: OLD_MRP });
    expect(await pending()).toHaveLength(0);
    expect(await priceEvents()).toBe(0);
  });
});

describe("new price for all stock now", () => {
  it("re-prices every unit at once and tells the ledger owner", async () => {
    const result = await restock(20, { pricing: { ...higher, policy: "now" } });
    expect(result.status).toBe("ok");
    expect(await price()).toEqual({ priceMinor: 119_900, mrpMinor: 139_900 });
    expect(await pending()).toHaveLength(0);
    expect(await priceEvents()).toBe(1);

    // The very next sale charges the new price.
    const sale = await sell(1);
    expect(sale.status).toBe("ok");
    const line = await db.saleItem.findFirstOrThrow({ where: { variantId: VARIANT } });
    expect(line.unitPriceMinor).toBe(119_900);
  });

  it("cancels a price that was still waiting behind older stock", async () => {
    await restock(10, { pricing: higher });
    expect((await pending())[0]!.status).toBe("PENDING");

    await restock(5, { pricing: { priceMinor: 110_000, mrpMinor: 130_000, policy: "now" } });
    expect((await pending())[0]!.status).toBe("CANCELLED");
    expect(await price()).toEqual({ priceMinor: 110_000, mrpMinor: 130_000 });
  });
});

describe("older stock sells first at its old price", () => {
  it("queues the new price behind exactly the units already on hand", async () => {
    const result = await restock(20, { pricing: higher });
    expect(result.status).toBe("ok");
    expect(await price()).toEqual({ priceMinor: OLD_PRICE, mrpMinor: OLD_MRP });
    const [queued] = await pending();
    expect(queued).toMatchObject({
      status: "PENDING",
      unitsAhead: 10,
      newPriceMinor: 119_900,
      previousPriceMinor: OLD_PRICE,
      sourceMovementId: result.status === "ok" ? result.movementId : undefined,
    });
  });

  it("switches by itself the moment the last older unit sells — not one sale earlier", async () => {
    await restock(20, { pricing: higher });

    await sell(9);
    expect((await price()).priceMinor).toBe(OLD_PRICE);
    expect((await pending())[0]!.unitsAhead).toBe(1);

    await sell(1);
    expect(await price()).toEqual({ priceMinor: 119_900, mrpMinor: 139_900 });
    const [applied] = await pending();
    expect(applied!.status).toBe("APPLIED");
    expect(applied!.appliedAt).not.toBeNull();
    expect(await priceEvents()).toBe(1);

    // Both sales before the switch were charged the old price; the next one, the new.
    await sell(1);
    const lines = await db.saleItem.findMany({ where: { variantId: VARIANT } });
    expect(lines.map((l) => l.unitPriceMinor).sort()).toEqual([OLD_PRICE, OLD_PRICE, 119_900].sort());
    expect(await findProjectionMismatches(db, IDS.tenantA)).toEqual([]);
  });

  it("a write-off counts as older stock leaving", async () => {
    await restock(20, { pricing: higher });
    const adj = await adjustStock({
      actor: owner,
      storeId: IDS.storeA,
      variantId: VARIANT,
      quantityDelta: -10,
      reason: "Damaged in storage",
      requestKey: key("adj"),
      correlationId: "corr-adj",
    });
    expect(adj.status).toBe("ok");
    expect((await price()).priceMinor).toBe(119_900);
  });

  it("with nothing on the shelf there is nothing to wait for, so it applies now", async () => {
    await sell(SEEDED_STOCK.variantA1);
    const result = await restock(20, { pricing: higher });
    expect(result.status).toBe("ok");
    expect((await price()).priceMinor).toBe(119_900);
    expect(await pending()).toHaveLength(0);
  });

  it("three deliveries at three prices switch in the order the shelf empties", async () => {
    await restock(5, { pricing: higher }); // 10 older units ahead of ₹1,199
    await restock(5, { pricing: { priceMinor: 129_900, mrpMinor: 149_900, policy: "after_older_stock" } }); // 15 ahead

    await sell(10);
    expect((await price()).priceMinor).toBe(119_900);
    await sell(5);
    expect((await price()).priceMinor).toBe(129_900);
    expect((await pending()).map((p) => p.status)).toEqual(["APPLIED", "APPLIED"]);
  });

  it("one large sale that clears two queues lands on the newest price", async () => {
    await restock(5, { pricing: higher });
    await restock(5, { pricing: { priceMinor: 129_900, mrpMinor: 149_900, policy: "after_older_stock" } });
    await sell(18);
    expect((await price()).priceMinor).toBe(129_900);
  });

  it("a price typed into the catalogue cancels the queue, so it is never silently undone", async () => {
    await restock(20, { pricing: higher });
    const edit = await updateVariant({
      actor: { tenantId: IDS.tenantA, userId: IDS.ownerA, tenantRole: "OWNER" },
      variantId: VARIANT,
      priceMinor: 105_000,
      correlationId: "corr-edit",
    });
    expect(edit.status).toBe("ok");
    expect((await pending())[0]!.status).toBe("CANCELLED");

    await sell(12);
    expect((await price()).priceMinor).toBe(105_000);
  });

  it("a retried receipt does not queue the price twice", async () => {
    const args = {
      actor: owner,
      storeId: IDS.storeA,
      variantId: VARIANT,
      quantity: 20,
      pricing: higher,
      requestKey: "same-receipt-key",
      correlationId: "corr-retry",
    };
    await receiveStock(args);
    const again = await receiveStock(args);
    expect(again.status === "ok" && again.duplicate).toBe(true);
    expect(await pending()).toHaveLength(1);
  });
});

describe("price validation", () => {
  it("never accepts a selling price above the MRP, and writes nothing", async () => {
    const result = await restock(20, { pricing: { priceMinor: 150_000, mrpMinor: 139_900, policy: "now" } });
    expect(result.status).toBe("validation_error");
    expect(await db.stockMovement.count({ where: { type: "RECEIPT" } })).toBe(0);
    expect(await price()).toEqual({ priceMinor: OLD_PRICE, mrpMinor: OLD_MRP });
  });

  it("refuses a zero price", async () => {
    const result = await restock(20, { pricing: { priceMinor: 0, mrpMinor: null, policy: "now" } });
    expect(result.status).toBe("validation_error");
  });
});

describe("sync", () => {
  it("sends the delivery's cost as the receipt rate and the new price to the item", async () => {
    await db.tenant.update({
      where: { id: IDS.tenantA },
      data: { erpnextProvisionStatus: "PROVISIONED", erpnextCompanyId: "Amburax Retail", erpnextSiteId: "test-site.local" },
    });
    await db.store.update({
      where: { id: IDS.storeA },
      data: { erpnextProvisionStatus: "PROVISIONED", erpnextWarehouseId: "Stores - AR" },
    });
    process.env["ERP_SITE_TEST_SITE_LOCAL_URL"] = "http://test-site.local";
    process.env["ERP_SITE_TEST_SITE_LOCAL_KEY"] = "test-key";
    process.env["ERP_SITE_TEST_SITE_LOCAL_SECRET"] = "test-secret";

    const transport = new FakeErpTransport();
    const publisher = new ErpOutboxPublisher(
      new ErpSaleAdapter(transport),
      new ErpCatalogAdapter(transport),
      new ErpStoreAdapter(transport),
      new ErpInventoryAdapter(transport),
    );
    // Everything else already in the outbox (the fixture's own events) is drained first.
    transport.always({ kind: "respond", status: 200, body: { data: [] } });
    await dispatchOutboxOnce({ publisher });
    transport.sent.length = 0;

    await restock(20, { unitCostMinor: 72_550, pricing: { ...higher, policy: "now" } });
    await dispatchOutboxOnce({ publisher });

    const entry = transport.sent.find((r) => r.method === "POST" && r.path.includes("Stock Entry"));
    const item = (entry?.body as { items: Record<string, unknown>[] }).items[0]!;
    expect(item["basic_rate"]).toBe(725.5);
    expect(item["qty"]).toBe(20);

    const itemWrite = transport.sent.find(
      (r) => (r.method === "POST" || r.method === "PUT") && r.path.includes("/Item"),
    );
    expect((itemWrite?.body as Record<string, unknown>)["standard_rate"]).toBe(1199);
  });
});
