import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS, SEEDED_STOCK } from "./db";
import { createSupplier } from "@/server/purchasing/suppliers";
import { createPurchaseReceipt, getPurchaseReceipt } from "@/server/purchasing/purchaseReceipts";
import { createPurchaseReturn } from "@/server/purchasing/purchaseReturns";
import { createSale } from "@/server/sales/saleService";
import { setApprovalPin, verifyApprovalPin, listApprovers, MAX_PIN_FAILURES } from "@/server/identity/approvalPin";
import { hashPassword } from "@/server/identity/password";
import { getSalesReport, resolveReportRange } from "@/server/reports/salesReport";
import { getStockSignal } from "@/server/dashboard/dashboardQueries";
import { findProjectionMismatches } from "@/server/inventory/stockLedger";

/**
 * Owner decisions 2026-10-14: weighted average cost, manager approval PIN, returns to supplier.
 * Fixture variant A1: Rs 1,000 at 5%, 10 units on hand in store A with no recorded cost.
 */

const VARIANT = COMMERCE_IDS.variantA1;
const owner = { tenantId: IDS.tenantA, userId: IDS.ownerA, tenantRole: "OWNER" as const, membershipRole: "OWNER" };
let supplierId = "";
let sku = "";

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
  await db.storeMembership.create({
    data: { tenantId: IDS.tenantA, userId: IDS.staffA, storeId: IDS.storeA, role: "CASHIER" },
  });
  const s = await createSupplier({ tenantId: IDS.tenantA, actorUserId: IDS.ownerA, input: { name: "Mill One" } });
  if (s.status !== "ok") throw new Error("seed failed");
  supplierId = s.supplier.id;
  sku = (await db.productVariant.findUniqueOrThrow({ where: { id: VARIANT } })).sku;
});

afterAll(async () => {
  await resetDatabase();
});

const level = () => db.stockLevel.findFirstOrThrow({ where: { storeId: IDS.storeA, variantId: VARIANT } });

async function purchase(quantity: number, unitCostMinor: number) {
  const res = await createPurchaseReceipt({
    actor: owner,
    storeId: IDS.storeA,
    supplierId,
    supplierInvoiceNo: `INV-${randomUUID().slice(0, 6)}`,
    lines: [{ sku, quantity, unitCostMinor, gstRateBp: 500 }],
    idempotencyKey: randomUUID(),
  });
  if (res.status !== "ok") throw new Error(`purchase failed: ${res.status}`);
  return res.receiptId;
}

function sell(params: {
  quantity?: number;
  cashier?: string;
  discountMinor?: number;
  discountReason?: string;
  approval?: { approverUserId: string; pin: string };
}) {
  return createSale({
    tenantId: IDS.tenantA,
    storeId: IDS.storeA,
    cashierUserId: params.cashier ?? IDS.ownerA,
    idempotencyKey: randomUUID(),
    lines: [{ variantId: VARIANT, quantity: params.quantity ?? 1 }],
    discountMinor: params.discountMinor,
    discountReason: params.discountReason,
    discountApproval: params.approval,
    payment: { method: "CASH" },
    correlationId: "corr-cost",
  });
}

async function sellOrThrow(quantity: number) {
  const res = await sell({ quantity });
  if (res.status !== "ok") throw new Error(`sale failed: ${res.status}`);
}

describe("weighted average cost", () => {
  it("averages deliveries on a costed shelf, and records the cost on each sale line", async () => {
    await sellOrThrow(SEEDED_STOCK.variantA1);
    await purchase(10, 50_000);
    expect(await level()).toMatchObject({ quantity: 10, avgCostMinor: 50_000, costIsEstimate: false });

    await purchase(30, 70_000);
    // (10 x 500 + 30 x 700) / 40 = 650.
    expect(await level()).toMatchObject({ quantity: 40, avgCostMinor: 65_000, costIsEstimate: false });

    const sale = await sell({ quantity: 2 });
    if (sale.status !== "ok") throw new Error("sale failed");
    const line = await db.saleItem.findFirstOrThrow({ where: { saleId: sale.sale.id } });
    expect(line.unitCostMinor).toBe(65_000);
    // Selling never moves the average.
    expect((await level()).avgCostMinor).toBe(65_000);
    expect(await findProjectionMismatches(db, IDS.tenantA)).toEqual([]);
  });

  it("flags the average as an estimate when costed goods land on uncosted stock", async () => {
    await purchase(10, 40_000);
    expect(await level()).toMatchObject({ quantity: 20, avgCostMinor: 40_000, costIsEstimate: true });
  });

  it("leaves lines with no known cost out of profit, and reports profit on the rest", async () => {
    await sellOrThrow(SEEDED_STOCK.variantA1); // sold before any cost was recorded
    await purchase(10, 50_000);
    await sellOrThrow(2); // Rs 2,000 incl. 5% GST, cost 2 x Rs 500

    const report = await getSalesReport({ tenantId: IDS.tenantA, storeId: IDS.storeA, range: resolveReportRange({}) });
    expect(report.profit.uncostedUnits).toBe(SEEDED_STOCK.variantA1);
    expect(report.profit.costedUnits).toBe(2);
    // Revenue excl. GST = 200,000 - round(200,000 x 500 / 10,500) = 190,476.
    expect(report.profit.revenueExTaxMinor).toBe(190_476);
    expect(report.profit.costMinor).toBe(100_000);
    expect(report.profit.profitMinor).toBe(90_476);
  });

  it("values stock on hand at cost on the dashboard", async () => {
    await sellOrThrow(SEEDED_STOCK.variantA1);
    await purchase(8, 45_000);
    const signal = await getStockSignal({ tenantId: IDS.tenantA, storeId: IDS.storeA });
    expect(signal.stockValueMinor).toBe(8 * 45_000);
    expect(signal.valueIncludesEstimate).toBe(false);
  });
});

describe("manager approval PIN", () => {
  beforeEach(async () => {
    await db.user.update({ where: { id: IDS.ownerA }, data: { passwordHash: await hashPassword("owner-pass-1") } });
  });

  const setOwnerPin = () =>
    setApprovalPin({ tenantId: IDS.tenantA, userId: IDS.ownerA, storeId: IDS.storeA, currentPassword: "owner-pass-1", pin: "4829" });

  it("sets a PIN only with the right password and refuses weak PINs", async () => {
    const base = { tenantId: IDS.tenantA, userId: IDS.ownerA, storeId: IDS.storeA };
    expect(await setApprovalPin({ ...base, currentPassword: "wrong", pin: "4829" })).toEqual({ status: "wrong_password" });
    expect((await setApprovalPin({ ...base, currentPassword: "owner-pass-1", pin: "1111" })).status).toBe("invalid_pin");
    expect((await setApprovalPin({ ...base, currentPassword: "owner-pass-1", pin: "1234" })).status).toBe("invalid_pin");
    expect(await setOwnerPin()).toEqual({ status: "ok" });
    const user = await db.user.findUniqueOrThrow({ where: { id: IDS.ownerA } });
    expect(user.approvalPinHash).not.toBe("4829");
    expect(await listApprovers({ tenantId: IDS.tenantA, storeId: IDS.storeA })).toEqual([
      { id: IDS.ownerA, name: expect.any(String) },
    ]);
  });

  it("a cashier's own PIN (for the shared till) never approves a discount", async () => {
    // Since the shared-counter PIN switch (owner 2026-10-15) everyone in the store may hold a PIN,
    // so setting one is no longer the gate: approval re-checks the role every time.
    const res = await setApprovalPin({
      tenantId: IDS.tenantA,
      userId: IDS.staffA,
      storeId: IDS.storeA,
      currentPassword: "x",
      pin: "4829",
    });
    expect(res.status).not.toBe("ok");
    await db.user.update({ where: { id: IDS.staffA }, data: { approvalPinHash: await hashPassword("4829") } });
    const verdict = await verifyApprovalPin({ tenantId: IDS.tenantA, storeId: IDS.storeA, approverUserId: IDS.staffA, pin: "4829" });
    expect(verdict.status).toBe("not_allowed");
  });

  it("approves a cashier's larger discount with the right PIN and records the approver", async () => {
    await setOwnerPin();
    const discount = { cashier: IDS.staffA, discountMinor: 25_000, discountReason: "Damaged hem" };

    expect((await sell(discount)).status).toBe("discount_not_allowed");
    expect(
      (await sell({ ...discount, approval: { approverUserId: IDS.ownerA, pin: "0000" } })).status,
    ).toBe("discount_not_allowed");
    expect(await db.sale.count({ where: { discountMinor: { gt: 0 } } })).toBe(0);

    const ok = await sell({ ...discount, approval: { approverUserId: IDS.ownerA, pin: "4829" } });
    expect(ok.status).toBe("ok");
    if (ok.status !== "ok") return;
    const row = await db.sale.findUniqueOrThrow({ where: { id: ok.sale.id } });
    expect(row).toMatchObject({ cashierUserId: IDS.staffA, discountAuthorisedByUserId: IDS.ownerA });
  });

  it("locks after repeated wrong PINs, and a cashier is not an approver", async () => {
    await setOwnerPin();
    const tryPin = (pin: string) =>
      verifyApprovalPin({ tenantId: IDS.tenantA, storeId: IDS.storeA, approverUserId: IDS.ownerA, pin });
    for (let i = 1; i < MAX_PIN_FAILURES; i++) {
      expect(await tryPin("0000")).toEqual({ status: "wrong_pin", attemptsLeft: MAX_PIN_FAILURES - i });
    }
    expect((await tryPin("0000")).status).toBe("locked");
    // Locked even for the right PIN until the lock expires.
    expect((await tryPin("4829")).status).toBe("locked");
    expect(
      await verifyApprovalPin({ tenantId: IDS.tenantA, storeId: IDS.storeA, approverUserId: IDS.staffA, pin: "4829" }),
    ).toEqual({ status: "not_allowed" });
  });
});

describe("returns to supplier", () => {
  it("returns part of a purchase, removes the stock and reverses the input GST", async () => {
    await sellOrThrow(SEEDED_STOCK.variantA1);
    const receiptId = await purchase(10, 50_000);
    const receipt = await getPurchaseReceipt({ tenantId: IDS.tenantA, receiptId });
    const lineId = receipt!.lines[0]!.id;

    const res = await createPurchaseReturn({
      actor: owner,
      receiptId,
      reason: "Damaged in transit",
      lines: [{ receiptLineId: lineId, quantity: 3 }],
      idempotencyKey: randomUUID(),
    });
    expect(res).toMatchObject({ status: "ok", duplicate: false });
    if (res.status !== "ok") return;

    const ret = await db.purchaseReturn.findUniqueOrThrow({ where: { id: res.returnId } });
    expect(ret).toMatchObject({ taxableMinor: 150_000, inputTaxMinor: 7_500, totalMinor: 157_500 });
    expect(await level()).toMatchObject({ quantity: 7, avgCostMinor: 50_000 });
    const movement = await db.stockMovement.findFirstOrThrow({ where: { referenceId: res.returnId } });
    expect(movement).toMatchObject({ type: "SUPPLIER_RETURN", quantityDelta: -3 });
    expect(await findProjectionMismatches(db, IDS.tenantA)).toEqual([]);
  });

  it("never returns more than was received less earlier returns, and writes nothing then", async () => {
    const receiptId = await purchase(5, 50_000);
    const lineId = (await getPurchaseReceipt({ tenantId: IDS.tenantA, receiptId }))!.lines[0]!.id;
    const ret = (quantity: number) =>
      createPurchaseReturn({
        actor: owner,
        receiptId,
        reason: "Wrong size",
        lines: [{ receiptLineId: lineId, quantity }],
        idempotencyKey: randomUUID(),
      });
    expect((await ret(4)).status).toBe("ok");
    expect((await ret(2)).status).toBe("validation_error");
    expect(await db.purchaseReturn.count()).toBe(1);
    expect((await ret(1)).status).toBe("ok");
    expect((await ret(1)).status).toBe("validation_error");
  });

  it("a retried return is recorded once, and a cashier cannot return stock", async () => {
    const receiptId = await purchase(5, 50_000);
    const lineId = (await getPurchaseReceipt({ tenantId: IDS.tenantA, receiptId }))!.lines[0]!.id;
    const args = {
      actor: owner,
      receiptId,
      reason: "Faded colour",
      lines: [{ receiptLineId: lineId, quantity: 2 }],
      idempotencyKey: "same-return-key",
    };
    await createPurchaseReturn(args);
    expect(await createPurchaseReturn(args)).toMatchObject({ status: "ok", duplicate: true });
    expect(await db.stockMovement.count({ where: { type: "SUPPLIER_RETURN" } })).toBe(1);
    expect(
      await createPurchaseReturn({
        ...args,
        idempotencyKey: randomUUID(),
        actor: { tenantId: IDS.tenantA, userId: IDS.staffA, tenantRole: "STAFF", membershipRole: "CASHIER" },
      }),
    ).toEqual({ status: "forbidden" });
  });
});
