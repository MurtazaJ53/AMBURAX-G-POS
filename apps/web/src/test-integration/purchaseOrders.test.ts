import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS, SEEDED_STOCK } from "./db";
import { createSupplier } from "@/server/purchasing/suppliers";
import { cancelPurchaseOrder, createPurchaseOrder, getPurchaseOrder } from "@/server/purchasing/purchaseOrders";
import { createPurchaseReceipt } from "@/server/purchasing/purchaseReceipts";
import { FakeErpTransport } from "@/server/erp/fakeTransport";
import { ErpPurchaseAdapter } from "@/server/erp/purchaseAdapter";

/** Purchase orders (screens 47-48), against real PostgreSQL; ERPNext faked. */

const owner = { tenantId: IDS.tenantA, userId: IDS.ownerA, tenantRole: "OWNER" as const, membershipRole: "OWNER" };
const name = (n: string) => ({ kind: "respond" as const, status: 200, body: { data: { name: n } } });
const none = { kind: "respond" as const, status: 200, body: { data: [] } };
const ok = { kind: "respond" as const, status: 200, body: { data: {} } };
const tomorrow = () => new Date(Date.now() + 86_400_000);

let supplierId = "";
let sku = "";

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
  // A GST-registered shop, so purchases carry input tax credit rows.
  await db.tenant.update({ where: { id: IDS.tenantA }, data: { taxId: "27AAACA1234A1Z5" } });
  const s = await createSupplier({ tenantId: IDS.tenantA, actorUserId: IDS.ownerA, input: { name: "Sharma Textiles" } });
  if (s.status !== "ok") throw new Error("supplier seed failed");
  supplierId = s.supplier.id;
  sku = (await db.productVariant.findUniqueOrThrow({ where: { id: COMMERCE_IDS.variantA1 } })).sku;
});

afterAll(async () => {
  await resetDatabase();
});

async function order(quantity = 10) {
  const res = await createPurchaseOrder({
    actor: owner,
    storeId: IDS.storeA,
    supplierId,
    expectedDate: tomorrow(),
    lines: [{ sku, quantity, unitCostMinor: 40_000, gstRateBp: 500 }],
    idempotencyKey: randomUUID(),
  });
  if (res.status !== "ok") throw new Error(`order failed: ${res.status}`);
  return res.orderId;
}

async function receive(orderId: string, quantity: number) {
  const o = (await getPurchaseOrder({ tenantId: IDS.tenantA, orderId }))!;
  return createPurchaseReceipt({
    actor: owner,
    storeId: IDS.storeA,
    supplierId,
    supplierInvoiceNo: `INV-${quantity}-${randomUUID().slice(0, 4)}`,
    lines: [{ sku, quantity, unitCostMinor: 40_000, gstRateBp: 500, purchaseOrderLineId: o.lines[0]!.id }],
    purchaseOrderId: orderId,
    idempotencyKey: randomUUID(),
  });
}

const stockA1 = async () =>
  (await db.stockLevel.findFirstOrThrow({ where: { storeId: IDS.storeA, variantId: COMMERCE_IDS.variantA1 } })).quantity;

describe("purchase orders", () => {
  it("placing an order changes no stock and queues one ERPNext order", async () => {
    const id = await order();
    expect(await stockA1()).toBe(SEEDED_STOCK.variantA1);
    expect(await db.outboxEvent.count({ where: { eventType: "PurchaseOrderCreated", entityId: id } })).toBe(1);
    expect((await getPurchaseOrder({ tenantId: IDS.tenantA, orderId: id }))!.progress).toBe("open");
  });

  it("refuses a past expected date", async () => {
    const res = await createPurchaseOrder({
      actor: owner,
      storeId: IDS.storeA,
      supplierId,
      expectedDate: new Date(Date.now() - 3 * 86_400_000),
      lines: [{ sku, quantity: 1, unitCostMinor: 100, gstRateBp: 500 }],
      idempotencyKey: randomUUID(),
    });
    expect(res.status).toBe("validation_error");
  });

  it("receives part, then the rest, and refuses more than was ordered", async () => {
    const id = await order(10);
    expect((await receive(id, 4)).status).toBe("ok");
    expect((await getPurchaseOrder({ tenantId: IDS.tenantA, orderId: id }))!.progress).toBe("part_received");

    const over = await receive(id, 7);
    expect(over).toMatchObject({ status: "validation_error" });
    // The refused delivery left no receipt and no stock behind.
    expect(await db.purchaseReceipt.count({ where: { purchaseOrderId: id } })).toBe(1);
    expect(await stockA1()).toBe(SEEDED_STOCK.variantA1 + 4);

    expect((await receive(id, 6)).status).toBe("ok");
    const done = (await getPurchaseOrder({ tenantId: IDS.tenantA, orderId: id }))!;
    expect(done.progress).toBe("received");
    expect(done.lines[0]!.receivedQuantity).toBe(10);
    expect(await stockA1()).toBe(SEEDED_STOCK.variantA1 + 10);
  });

  it("can't be cancelled once goods arrived, and can be before", async () => {
    const received = await order();
    await receive(received, 1);
    expect((await cancelPurchaseOrder({ actor: owner, orderId: received })).status).toBe("conflict");

    const fresh = await order();
    expect((await cancelPurchaseOrder({ actor: owner, orderId: fresh })).status).toBe("ok");
    expect((await receive(fresh, 1)).status).toBe("validation_error");
    expect(await db.outboxEvent.count({ where: { eventType: "PurchaseOrderCancelled", entityId: fresh } })).toBe(1);
  });

  it("another tenant's order is invisible", async () => {
    const id = await order();
    expect(await getPurchaseOrder({ tenantId: IDS.tenantB, orderId: id })).toBeNull();
  });
});

describe("ERPNext sync", () => {
  beforeEach(async () => {
    await db.tenant.update({
      where: { id: IDS.tenantA },
      data: { erpnextProvisionStatus: "PROVISIONED", erpnextCompanyId: "Amburax Retail", erpnextSiteId: "test-site.local" },
    });
    await db.store.update({ where: { id: IDS.storeA }, data: { erpnextWarehouseId: "Stores - AR" } });
    await db.supplier.update({ where: { id: supplierId }, data: { erpnextName: "Sharma Textiles" } });
    process.env["ERP_SITE_TEST_SITE_LOCAL_URL"] = "http://test-site.local";
    process.env["ERP_SITE_TEST_SITE_LOCAL_KEY"] = "test-key";
    process.env["ERP_SITE_TEST_SITE_LOCAL_SECRET"] = "test-secret";
  });

  it("submits the Purchase Order, keeps its row names, and receipts cite them", async () => {
    const id = await order(10);
    // Unregistered supplier: no GST template lookup. Lookup, create, submit, then read rows back.
    const transport = new FakeErpTransport().script(none, name("PUR-ORD-0001"), ok, {
      kind: "respond",
      status: 200,
      body: { data: { name: "PUR-ORD-0001", items: [{ name: "poi-row-1", idx: 1 }] } },
    });
    expect(await new ErpPurchaseAdapter(transport).syncOrder(IDS.tenantA, id, "corr-po")).toBe("PUR-ORD-0001");

    const post = transport.sent.find((r) => r.method === "POST")!;
    expect(post.path).toBe("/api/resource/Purchase Order");
    expect(post.body).toMatchObject({ supplier: "Sharma Textiles", set_warehouse: "Stores - AR" });
    expect((post.body as { items: unknown[] }).items[0]).toMatchObject({ item_code: COMMERCE_IDS.variantA1, qty: 10, rate: 400 });
    expect((await getPurchaseOrder({ tenantId: IDS.tenantA, orderId: id }))!.erpSyncStatus).toBe("SYNCED");
    expect(await db.purchaseOrderLine.findFirstOrThrow({ where: { orderId: id } })).toMatchObject({ erpnextItemName: "poi-row-1" });

    const got = await receive(id, 4);
    if (got.status !== "ok") throw new Error("receive failed");
    const receiptTransport = new FakeErpTransport().script(none, name("MAT-PRE-0009"), ok, none, name("ACC-PINV-0009"));
    await new ErpPurchaseAdapter(receiptTransport).syncReceipt(IDS.tenantA, got.receiptId, "corr-pr");
    const pr = receiptTransport.sent.find((r) => r.method === "POST" && r.path === "/api/resource/Purchase Receipt")!;
    expect((pr.body as { items: unknown[] }).items[0]).toMatchObject({
      purchase_order: "PUR-ORD-0001",
      purchase_order_item: "poi-row-1",
      qty: 4,
    });
  });
});
