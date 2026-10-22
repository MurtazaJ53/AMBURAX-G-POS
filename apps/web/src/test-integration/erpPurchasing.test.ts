import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS } from "./db";
import { createSupplier } from "@/server/purchasing/suppliers";
import { createPurchaseReceipt } from "@/server/purchasing/purchaseReceipts";
import { createPurchaseReturn } from "@/server/purchasing/purchaseReturns";
import { cancelTransfer, receiveTransfer, sendTransfer } from "@/server/inventory/stockTransfers";
import { FakeErpTransport } from "@/server/erp/fakeTransport";
import { ErpSupplierAdapter } from "@/server/erp/supplierAdapter";
import { ErpPurchaseAdapter } from "@/server/erp/purchaseAdapter";
import { ErpTransferAdapter } from "@/server/erp/transferAdapter";
import { ErpSaleAdapter } from "@/server/erp/saleAdapter";
import { ErpCatalogAdapter } from "@/server/erp/catalogAdapter";
import { ErpStoreAdapter } from "@/server/erp/storeAdapter";
import { ErpInventoryAdapter } from "@/server/erp/inventoryAdapter";
import { ErpCustomerAdapter } from "@/server/erp/customerAdapter";
import { ErpPaymentAdapter } from "@/server/erp/paymentAdapter";
import { ErpReturnAdapter } from "@/server/erp/returnAdapter";
import { ErpOutboxPublisher } from "@/server/erp/outboxPublisher";
import { dispatchOutboxOnce } from "@/server/events/outboxDispatcher";

/**
 * ERPNext-first purchasing and transfers (owner rule 2026-10-14): suppliers, purchase receipts,
 * supplier returns and store transfers reach ERPNext as ERPNext's own documents.
 */

const STORE_A2 = "s-aaaaaaaaaaaaaaaaaaaaaaa2";
const owner = { tenantId: IDS.tenantA, userId: IDS.ownerA, tenantRole: "OWNER" as const, membershipRole: "OWNER" };
const name = (n: string) => ({ kind: "respond" as const, status: 200, body: { data: { name: n } } });
const none = { kind: "respond" as const, status: 200, body: { data: [] } };
const ok = { kind: "respond" as const, status: 200, body: { data: {} } };
const transit = { kind: "respond" as const, status: 200, body: { data: [{ name: "Goods In Transit - AR" }] } };
/** ERPNext's reply to the GST template lookup: the list, then the template with its account heads. */
const template = (title: string, heads: string[]) => [
  { kind: "respond" as const, status: 200, body: { data: [{ name: title }] } },
  { kind: "respond" as const, status: 200, body: { data: { name: title, taxes: heads.map((account_head) => ({ account_head })) } } },
];
const outState = template("Out-State GST - AR", ["Input Tax IGST - AR"]);
const inState = template("In-State GST - AR", ["Input Tax CGST - AR", "Input Tax SGST - AR"]);

let transport: FakeErpTransport;
let supplierId = "";
let sku = "";

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
  await db.tenant.update({
    where: { id: IDS.tenantA },
    // A GST-registered shop (it claims input tax credit); the unregistered case clears this.
    data: { erpnextProvisionStatus: "PROVISIONED", erpnextCompanyId: "Amburax Retail", erpnextSiteId: "test-site.local", taxId: "27AAACA1234A1Z5" },
  });
  const storeA = await db.store.update({ where: { id: IDS.storeA }, data: { erpnextWarehouseId: "Stores - AR" } });
  await db.store.create({
    data: {
      id: STORE_A2,
      tenantId: IDS.tenantA,
      name: "MG Road",
      code: "ST-002",
      currency: storeA.currency,
      addressLine: "1 MG Rd",
      city: "Bengaluru",
      state: "Karnataka",
      erpnextWarehouseId: "MG Road - AR",
    },
  });
  process.env["ERP_SITE_TEST_SITE_LOCAL_URL"] = "http://test-site.local";
  process.env["ERP_SITE_TEST_SITE_LOCAL_KEY"] = "test-key";
  process.env["ERP_SITE_TEST_SITE_LOCAL_SECRET"] = "test-secret";
  transport = new FakeErpTransport();

  const s = await createSupplier({
    tenantId: IDS.tenantA,
    actorUserId: IDS.ownerA,
    input: { name: "Sharma Textiles", gstin: "29ABCDE1234F1Z5" },
  });
  if (s.status !== "ok") throw new Error("supplier seed failed");
  supplierId = s.supplier.id;
  sku = (await db.productVariant.findUniqueOrThrow({ where: { id: COMMERCE_IDS.variantA1 } })).sku;
});

afterAll(async () => {
  await resetDatabase();
});

async function receive() {
  const res = await createPurchaseReceipt({
    actor: owner,
    storeId: IDS.storeA,
    supplierId,
    supplierInvoiceNo: "INV-101",
    lines: [{ sku, quantity: 12, unitCostMinor: 50_000, gstRateBp: 500 }],
    idempotencyKey: randomUUID(),
  });
  if (res.status !== "ok") throw new Error("receipt failed");
  return res.receiptId;
}

const posts = (doctype: string) =>
  transport.sent.filter((r) => r.method === "POST" && r.path === `/api/resource/${doctype}`);

describe("ERPNext sync: suppliers", () => {
  it("creates the ERPNext Supplier with its GSTIN and keeps the mapping", async () => {
    transport.script(none, name("Sharma Textiles"));
    await new ErpSupplierAdapter(transport).syncSupplier(IDS.tenantA, supplierId, "corr-s1");

    const body = posts("Supplier")[0]!.body as Record<string, unknown>;
    expect(body).toMatchObject({ supplier_name: "Sharma Textiles", tax_id: "29ABCDE1234F1Z5", disabled: 0 });
    expect(await db.supplier.findUniqueOrThrow({ where: { id: supplierId } })).toMatchObject({
      erpnextName: "Sharma Textiles",
      erpSyncStatus: "SYNCED",
    });
  });

  it("updates rather than duplicates once mapped", async () => {
    await db.supplier.update({ where: { id: supplierId }, data: { erpnextName: "Sharma Textiles", isActive: false } });
    await new ErpSupplierAdapter(transport).syncSupplier(IDS.tenantA, supplierId, "corr-s2");
    expect(posts("Supplier")).toHaveLength(0);
    const put = transport.sent.find((r) => r.method === "PUT")!;
    expect(put.path).toBe("/api/resource/Supplier/Sharma%20Textiles");
    expect(put.body).toMatchObject({ disabled: 1 });
  });
});

describe("ERPNext sync: purchase receipts and supplier returns", () => {
  it("emits one PurchaseReceiptCreated event and no per-line stock entries", async () => {
    const receiptId = await receive();
    expect(await db.outboxEvent.count({ where: { eventType: "PurchaseReceiptCreated", entityId: receiptId } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { eventType: "StockMovementCreated" } })).toBe(0);
  });

  it("creates and submits a Purchase Receipt at the cost excluding GST, syncing the supplier first", async () => {
    const receiptId = await receive();
    transport.script(
      ...outState,
      none,
      name("Sharma Textiles"),
      none,
      name("MAT-PRE-0001"),
      ok,
      none,
      name("ACC-PINV-0001"),
    );
    const erpName = await new ErpPurchaseAdapter(transport).syncReceipt(IDS.tenantA, receiptId, "corr-r1");

    expect(erpName).toBe("MAT-PRE-0001");
    const body = posts("Purchase Receipt")[0]!.body as Record<string, unknown>;
    expect(body).toMatchObject({
      supplier: "Sharma Textiles",
      set_warehouse: "Stores - AR",
      supplier_delivery_note: "INV-101",
      remarks: `amburax-purchase-receipt-id:${receiptId}`,
    });
    expect((body.items as unknown[])[0]).toMatchObject({ item_code: COMMERCE_IDS.variantA1, qty: 12, rate: 500 });
    // Supplier GSTIN state 29 (Karnataka), store in MH (27): inter-state, so IGST — the 5% AMBURAX recorded.
    expect(body.taxes).toEqual([
      expect.objectContaining({ charge_type: "Actual", account_head: "Input Tax IGST - AR", tax_amount: 300 }),
    ]);
    expect(transport.sent).toContainEqual(
      expect.objectContaining({ method: "PUT", path: "/api/resource/Purchase Receipt/MAT-PRE-0001", body: { docstatus: 1 } }),
    );

    // The bill: a DRAFT Purchase Invoice against the receipt — never submitted by AMBURAX (ITC, CGST s.16).
    const invoice = posts("Purchase Invoice")[0]!.body as Record<string, unknown>;
    expect(invoice).toMatchObject({ supplier: "Sharma Textiles", bill_no: "INV-101", update_stock: 0 });
    expect((invoice.items as unknown[])[0]).toMatchObject({ purchase_receipt: "MAT-PRE-0001", qty: 12, rate: 500 });
    expect(invoice.taxes).toEqual(body.taxes);
    expect(transport.sent.some((r) => r.method === "PUT" && r.path.includes("Purchase Invoice"))).toBe(false);

    expect(await db.purchaseReceipt.findUniqueOrThrow({ where: { id: receiptId } })).toMatchObject({
      erpnextName: "MAT-PRE-0001",
      erpnextInvoiceName: "ACC-PINV-0001",
      erpSyncStatus: "SYNCED",
    });
  });

  it("splits GST into CGST and SGST when the supplier is in the store's state", async () => {
    await db.supplier.update({ where: { id: supplierId }, data: { gstin: "27ABCDE1234F1Z5", erpnextName: "Sharma Textiles" } });
    const receiptId = await receive();
    transport.script(...inState, none, name("MAT-PRE-0002"), ok, none, name("ACC-PINV-0002"));
    await new ErpPurchaseAdapter(transport).syncReceipt(IDS.tenantA, receiptId, "corr-r4");

    const body = posts("Purchase Receipt")[0]!.body as Record<string, unknown>;
    expect(body.taxes).toEqual([
      expect.objectContaining({ account_head: "Input Tax CGST - AR", tax_amount: 150 }),
      expect.objectContaining({ account_head: "Input Tax SGST - AR", tax_amount: 150 }),
    ]);
  });

  it("sends no GST rows for an unregistered supplier", async () => {
    await db.supplier.update({ where: { id: supplierId }, data: { gstin: null, erpnextName: "Sharma Textiles" } });
    const receiptId = await receive();
    transport.script(none, name("MAT-PRE-0003"), ok, none, name("ACC-PINV-0003"));
    await new ErpPurchaseAdapter(transport).syncReceipt(IDS.tenantA, receiptId, "corr-r5");
    expect((posts("Purchase Receipt")[0]!.body as Record<string, unknown>).taxes).toEqual([]);
  });

  it("a shop without GST claims no input credit: the GST goes into the stock cost, no tax rows (owner 2026-10-20)", async () => {
    await db.tenant.update({ where: { id: IDS.tenantA }, data: { taxId: null } });
    await db.supplier.update({ where: { id: supplierId }, data: { erpnextName: "Sharma Textiles" } });
    const receiptId = await receive();
    transport.script(none, name("MAT-PRE-0009"), ok, none, name("ACC-PINV-0009"));
    await new ErpPurchaseAdapter(transport).syncReceipt(IDS.tenantA, receiptId, "corr-unreg");

    const body = posts("Purchase Receipt")[0]!.body as Record<string, unknown>;
    expect(body.taxes).toEqual([]);
    // 12 x 500 + 5% GST (300) = 6,300 of stock: 525 a piece.
    expect((body.items as unknown[])[0]).toMatchObject({ qty: 12, rate: 525 });
    const invoice = posts("Purchase Invoice")[0]!.body as Record<string, unknown>;
    expect(invoice.taxes).toEqual([]);
    expect((invoice.items as unknown[])[0]).toMatchObject({ qty: 12, rate: 525 });
  });

  it("refuses to guess the tax type when the store's state is not recognised", async () => {
    await db.store.update({ where: { id: IDS.storeA }, data: { state: "Atlantis" } });
    const receiptId = await receive();
    await expect(new ErpPurchaseAdapter(transport).syncReceipt(IDS.tenantA, receiptId, "corr-r6")).rejects.toThrow(
      /not a recognised GST state/,
    );
    expect(posts("Purchase Receipt")).toHaveLength(0);
    expect((await db.purchaseReceipt.findUniqueOrThrow({ where: { id: receiptId } })).erpSyncStatus).toBe("FAILED");
  });

  it("does not create a second Purchase Receipt when ERPNext already has it", async () => {
    const receiptId = await receive();
    transport.script(
      ...outState,
      none,
      name("Sharma Textiles"),
      { kind: "respond", status: 200, body: { data: [{ name: "MAT-PRE-0001" }] } },
      none,
      name("ACC-PINV-0001"),
    );
    await new ErpPurchaseAdapter(transport).syncReceipt(IDS.tenantA, receiptId, "corr-r2");
    expect(posts("Purchase Receipt")).toHaveLength(0);
    expect(posts("Purchase Invoice")).toHaveLength(1);
  });

  it("sends a supplier return as a Purchase Receipt return against the original", async () => {
    const receiptId = await receive();
    await db.supplier.update({ where: { id: supplierId }, data: { erpnextName: "Sharma Textiles" } });
    await db.purchaseReceipt.update({
      where: { id: receiptId },
      data: { erpnextName: "MAT-PRE-0001", erpnextInvoiceName: "ACC-PINV-0001", erpSyncStatus: "SYNCED" },
    });
    const line = await db.purchaseReceiptLine.findFirstOrThrow({ where: { receiptId } });
    const ret = await createPurchaseReturn({
      actor: owner,
      receiptId,
      reason: "Torn stitching",
      lines: [{ receiptLineId: line.id, quantity: 2 }],
      idempotencyKey: randomUUID(),
    });
    if (ret.status !== "ok") throw new Error("return failed");
    expect(await db.outboxEvent.count({ where: { eventType: "PurchaseReturnCreated", entityId: ret.returnId } })).toBe(1);

    transport.script(none, ...outState, name("MAT-PRE-RET-0001"), ok);
    await new ErpPurchaseAdapter(transport).syncReturn(IDS.tenantA, ret.returnId, "corr-ret");

    const body = posts("Purchase Receipt")[0]!.body as Record<string, unknown>;
    expect(body).toMatchObject({ is_return: 1, return_against: "MAT-PRE-0001", supplier: "Sharma Textiles" });
    expect((body.items as unknown[])[0]).toMatchObject({ qty: -2, rate: 500 });
    // The GST on the returned goods comes back off: 2 x 500 at 5%.
    expect(body.taxes).toEqual([expect.objectContaining({ account_head: "Input Tax IGST - AR", tax_amount: -50 })]);
    expect(await db.purchaseReturn.findUniqueOrThrow({ where: { id: ret.returnId } })).toMatchObject({
      erpnextName: "MAT-PRE-RET-0001",
      erpSyncStatus: "SYNCED",
    });
  });

  it("marks the receipt FAILED when the tenant has no ERPNext site", async () => {
    const receiptId = await receive();
    await db.tenant.update({ where: { id: IDS.tenantA }, data: { erpnextProvisionStatus: "NOT_PROVISIONED", erpnextSiteId: null } });
    await expect(new ErpPurchaseAdapter(transport).syncReceipt(IDS.tenantA, receiptId, "corr-r3")).rejects.toThrow();
    expect((await db.purchaseReceipt.findUniqueOrThrow({ where: { id: receiptId } })).erpSyncStatus).toBe("FAILED");
    expect(transport.sent).toHaveLength(0);
  });
});

describe("ERPNext sync: transfers through the transit warehouse", () => {
  async function send(quantity: number) {
    const res = await sendTransfer({
      actor: owner,
      fromStoreId: IDS.storeA,
      toStoreId: STORE_A2,
      lines: [{ sku, quantity }],
      idempotencyKey: randomUUID(),
    });
    if (res.status !== "ok") throw new Error(`send failed: ${res.status}`);
    return res.transferId;
  }

  it("send moves stock from the store into transit", async () => {
    const id = await send(5);
    expect(await db.outboxEvent.count({ where: { eventType: "StockTransferSent", entityId: id } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { eventType: "StockMovementCreated" } })).toBe(0);

    transport.script(transit, none, name("SE-0001"), ok);
    await new ErpTransferAdapter(transport).syncSent(IDS.tenantA, id, "corr-t1");

    const body = posts("Stock Entry")[0]!.body as Record<string, unknown>;
    expect(body).toMatchObject({ purpose: "Material Transfer", remarks: `amburax-transfer-send:${id}` });
    expect((body.items as unknown[])[0]).toMatchObject({
      qty: 5,
      s_warehouse: "Stores - AR",
      t_warehouse: "Goods In Transit - AR",
    });
    expect(await db.stockTransfer.findUniqueOrThrow({ where: { id } })).toMatchObject({
      erpnextSendEntry: "SE-0001",
      erpSyncStatus: "SYNCED",
    });
  });

  it("receive moves what arrived to the destination and issues the shortfall from transit", async () => {
    const id = await send(5);
    await db.stockTransfer.update({ where: { id }, data: { erpnextSendEntry: "SE-0001" } });
    const line = await db.stockTransferLine.findFirstOrThrow({ where: { transferId: id } });
    const got = await receiveTransfer({ actor: owner, transferId: id, received: { [line.id]: 3 } });
    expect(got.status).toBe("ok");

    transport.script(transit, none, name("SE-0002"), ok, none, name("SE-0003"), ok);
    await new ErpTransferAdapter(transport).syncReceived(IDS.tenantA, id, "corr-t2");

    const [moved, issued] = posts("Stock Entry").map((r) => r.body as Record<string, unknown>);
    expect(moved).toMatchObject({ purpose: "Material Transfer" });
    expect((moved!.items as unknown[])[0]).toMatchObject({ qty: 3, s_warehouse: "Goods In Transit - AR", t_warehouse: "MG Road - AR" });
    expect(issued).toMatchObject({ purpose: "Material Issue" });
    expect((issued!.items as unknown[])[0]).toMatchObject({ qty: 2, s_warehouse: "Goods In Transit - AR" });
    expect((await db.stockTransfer.findUniqueOrThrow({ where: { id } })).erpnextReceiveEntry).toBe("SE-0002");
  });

  it("cancel returns transit stock to the source, creating the send first if it never synced", async () => {
    const id = await send(4);
    const cancelled = await cancelTransfer({ actor: owner, transferId: id });
    expect(cancelled.status).toBe("ok");

    transport.script(transit, none, name("SE-0001"), ok, none, name("SE-0004"), ok);
    await new ErpTransferAdapter(transport).syncCancelled(IDS.tenantA, id, "corr-t3");

    const [out, back] = posts("Stock Entry").map((r) => r.body as Record<string, unknown>);
    expect((out!.items as unknown[])[0]).toMatchObject({ s_warehouse: "Stores - AR", t_warehouse: "Goods In Transit - AR" });
    expect((back!.items as unknown[])[0]).toMatchObject({ qty: 4, s_warehouse: "Goods In Transit - AR", t_warehouse: "Stores - AR" });
  });
});

describe("ERPNext sync: outbox routing", () => {
  it("the publisher delivers supplier and receipt events to their adapters", async () => {
    await receive();
    const publisher = new ErpOutboxPublisher(
      new ErpSaleAdapter(transport),
      new ErpCatalogAdapter(transport),
      new ErpStoreAdapter(transport),
      new ErpInventoryAdapter(transport),
      new ErpCustomerAdapter(transport),
      new ErpPaymentAdapter(transport),
      new ErpReturnAdapter(transport),
      new ErpSupplierAdapter(transport),
      new ErpPurchaseAdapter(transport),
      new ErpTransferAdapter(transport),
    );
    // SupplierCreated (lookup, create), then PurchaseReceiptCreated (GST template, receipt, draft invoice).
    transport.script(
      none,
      name("Sharma Textiles"),
      ...outState,
      none,
      name("MAT-PRE-0001"),
      ok,
      none,
      name("ACC-PINV-0001"),
    );
    const { published, failed } = await dispatchOutboxOnce({ publisher });
    expect(failed).toBe(0);
    expect(published).toBe(2);
    expect(posts("Supplier")).toHaveLength(1);
    expect(posts("Purchase Receipt")).toHaveLength(1);
  });
});
