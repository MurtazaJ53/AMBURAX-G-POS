import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS, SEEDED_STOCK } from "./db";
import { createSupplier } from "@/server/purchasing/suppliers";
import { createPurchaseReceipt, getPurchaseReceipt } from "@/server/purchasing/purchaseReceipts";
import { findProjectionMismatches } from "@/server/inventory/stockLedger";

/** Purchase receipts (owner decision 2026-10-13: cost excluding GST, input GST stored separately). */

const owner = { tenantId: IDS.tenantA, userId: IDS.ownerA, tenantRole: "OWNER" as const, membershipRole: "OWNER" };
let supplierId = "";
let sku = "";

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
  const s = await createSupplier({ tenantId: IDS.tenantA, actorUserId: IDS.ownerA, input: { name: "Sharma Textiles" } });
  if (s.status !== "ok") throw new Error("supplier seed failed");
  supplierId = s.supplier.id;
  sku = (await db.productVariant.findUniqueOrThrow({ where: { id: COMMERCE_IDS.variantA1 } })).sku;
});

afterAll(async () => {
  await resetDatabase();
});

function receive(extra: Partial<Parameters<typeof createPurchaseReceipt>[0]> = {}) {
  return createPurchaseReceipt({
    actor: owner,
    storeId: IDS.storeA,
    supplierId,
    supplierInvoiceNo: "INV-101",
    lines: [{ sku, quantity: 12, unitCostMinor: 50_000, gstRateBp: 500 }],
    idempotencyKey: randomUUID(),
    ...extra,
  });
}

describe("purchase receipts", () => {
  it("adds stock with its cost excluding GST and stores the input GST", async () => {
    const res = await receive();
    expect(res).toMatchObject({ status: "ok", duplicate: false });
    if (res.status !== "ok") return;

    const receipt = await getPurchaseReceipt({ tenantId: IDS.tenantA, receiptId: res.receiptId });
    expect(receipt).toMatchObject({ taxableMinor: 600_000, inputTaxMinor: 30_000, totalMinor: 630_000 });
    expect(receipt!.lines[0]).toMatchObject({ quantity: 12, unitCostMinor: 50_000, gstRateBp: 500, inputTaxMinor: 30_000 });

    const level = await db.stockLevel.findFirstOrThrow({ where: { storeId: IDS.storeA, variantId: COMMERCE_IDS.variantA1 } });
    expect(level.quantity).toBe(SEEDED_STOCK.variantA1 + 12);
    const movement = await db.stockMovement.findFirstOrThrow({ where: { referenceId: res.receiptId } });
    expect(movement).toMatchObject({ type: "RECEIPT", quantityDelta: 12, unitCostMinor: 50_000 });
    // ERPNext-first: the receipt syncs as one Purchase Receipt; its lines never also sync as Stock Entries.
    expect(await db.outboxEvent.count({ where: { eventType: "PurchaseReceiptCreated", entityId: res.receiptId } })).toBe(1);
    expect(await db.outboxEvent.count({ where: { eventType: "StockMovementCreated", entityId: movement.id } })).toBe(0);
    expect(await findProjectionMismatches(db, IDS.tenantA)).toEqual([]);
  });

  it("a retried save does not receive the goods twice", async () => {
    const idempotencyKey = randomUUID();
    const first = await receive({ idempotencyKey });
    const again = await receive({ idempotencyKey });
    expect(again).toMatchObject({ status: "ok", duplicate: true });
    expect(first.status === "ok" && again.status === "ok" && first.receiptId === again.receiptId).toBe(true);
    expect(await db.purchaseReceipt.count()).toBe(1);
    expect(await db.stockMovement.count({ where: { referenceType: "PURCHASE_RECEIPT" } })).toBe(1);
  });

  it("writes nothing when any line is invalid or unknown", async () => {
    expect(await receive({ lines: [{ sku: "NO-SUCH-SKU", quantity: 1, unitCostMinor: 100, gstRateBp: 500 }] })).toEqual({
      status: "unknown_sku",
      sku: "NO-SUCH-SKU",
    });
    expect((await receive({ lines: [{ sku, quantity: 0, unitCostMinor: 100, gstRateBp: 500 }] })).status).toBe(
      "validation_error",
    );
    expect((await receive({ supplierInvoiceNo: "  " })).status).toBe("validation_error");
    expect(await db.purchaseReceipt.count()).toBe(0);
    expect(await db.stockMovement.count({ where: { type: "RECEIPT" } })).toBe(0);
  });

  it("refuses another tenant's supplier and a role without inventory rights", async () => {
    const b = await createSupplier({ tenantId: IDS.tenantB, actorUserId: IDS.ownerB, input: { name: "B Mill" } });
    if (b.status !== "ok") throw new Error("seed failed");
    expect(await receive({ supplierId: b.supplier.id })).toEqual({ status: "not_found", what: "supplier" });
    expect(
      await receive({ actor: { tenantId: IDS.tenantA, userId: IDS.staffA, tenantRole: "STAFF", membershipRole: "CASHIER" } }),
    ).toEqual({ status: "forbidden" });
  });
});
