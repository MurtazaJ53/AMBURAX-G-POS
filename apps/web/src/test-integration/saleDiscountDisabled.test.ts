import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, IDS, COMMERCE_IDS, resetDatabase, seedTwoTenants, seedCommerce } from "./db";
import { createSale } from "@/server/sales/saleService";

/**
 * Bill discounts are allowed only with a reason (owner rules 2026-10-13; the allowed paths are in
 * saleDiscount.test.ts). Against real PostgreSQL: a discount with no reason writes nothing at
 * all, an already-created sale still replays, and missing or zero discounts leave every tender
 * path working as before.
 */

const T = IDS.tenantA;
let seq = 0;
const key = (p: string) => `${p}-${++seq}-${Date.now()}`;

const sell = (extra: Partial<Parameters<typeof createSale>[0]> = {}) =>
  createSale({
    tenantId: T,
    storeId: IDS.storeA,
    cashierUserId: IDS.ownerA,
    idempotencyKey: key("sale"),
    lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 1 }],
    correlationId: "corr-discount",
    ...extra,
  });

async function counts() {
  return {
    sales: await db.sale.count(),
    salePayments: await db.salePayment.count(),
    saleItems: await db.saleItem.count(),
    stockMovements: await db.stockMovement.count({ where: { type: "SALE" } }),
    receivables: await db.khataReceivableEntry.count(),
    outbox: await db.outboxEvent.count({ where: { eventType: "SaleCompleted" } }),
    audits: await db.auditLog.count({ where: { action: "SaleCompleted" } }),
  };
}

const ZERO = { sales: 0, salePayments: 0, saleItems: 0, stockMovements: 0, receivables: 0, outbox: 0, audits: 0 };

beforeEach(async () => {
  seq = 0;
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
});

afterAll(async () => {
  await resetDatabase();
});

describe("non-zero discounts without a reason are refused", () => {
  it.each([1, 500, 99_999_999])("discountMinor %i writes no sale, payment, item, stock movement, ledger entry, outbox event or audit", async (discountMinor) => {
    const res = await sell({ discountMinor, payment: { method: "CASH" } });
    expect(res).toEqual({ status: "discount_not_allowed", reason: "Give a reason for the discount." });
    expect(await counts()).toEqual(ZERO);
  });

  it("refuses across tenders and with a customer attached", async () => {
    for (const payment of [{ method: "CASH" as const }, { method: "UPI" as const }, { method: "CARD" as const }]) {
      expect(await sell({ discountMinor: 100, payment, customerId: COMMERCE_IDS.customerA })).toEqual({
        status: "discount_not_allowed",
        reason: "Give a reason for the discount.",
      });
    }
    expect(await counts()).toEqual(ZERO);
  });

  it("an already-created sale still replays when the retry carries a discount", async () => {
    const idempotencyKey = key("replay");
    const first = await sell({ idempotencyKey, payment: { method: "CASH" } });
    if (first.status !== "ok") throw new Error(first.status);

    const retry = await sell({ idempotencyKey, discountMinor: 500, payment: { method: "CASH" } });
    expect(retry).toMatchObject({ status: "ok", duplicate: true, sale: { id: first.sale.id, discountMinor: 0 } });
    expect(await db.sale.count()).toBe(1);
  });
});

describe("missing and zero discounts are unchanged", () => {
  it.each([
    ["CASH", undefined],
    ["CASH", 0],
    ["UPI", undefined],
    ["UPI", 0],
    ["CARD", undefined],
    ["CARD", 0],
  ] as const)("a %s sale with discount %s completes", async (method, discountMinor) => {
    const res = await sell({ payment: { method }, ...(discountMinor === undefined ? {} : { discountMinor }) });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.sale.discountMinor).toBe(0);
    expect(res.sale.paidMinor).toBe(res.sale.totalMinor);
    expect(await db.salePayment.count({ where: { saleId: res.sale.id } })).toBe(1);
  });

  it("a split-tender sale with a zero discount completes", async () => {
    const probe = await sell({ payment: { method: "CASH" } });
    if (probe.status !== "ok") throw new Error(probe.status);
    const total = probe.sale.totalMinor;
    const half = Math.floor(total / 2);

    const res = await sell({
      discountMinor: 0,
      payments: [
        { method: "CASH", amountMinor: half },
        { method: "UPI", amountMinor: total - half },
      ],
    });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.sale.discountMinor).toBe(0);
    expect(res.sale.paidMinor).toBe(total);
    expect(await db.salePayment.count({ where: { saleId: res.sale.id } })).toBe(2);
  });
});
