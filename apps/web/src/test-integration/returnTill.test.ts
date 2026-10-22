import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS } from "./db";
import { createSale } from "@/server/sales/saleService";
import { createReturn } from "@/server/sales/returnService";
import { getRegister } from "@/server/pos/cashRegister";
import { openTestTill } from "./till";

/** E7 (owner 2026-10-14): every return records the till that paid it; cash can't overdraw a drawer. */

const owner = { userId: IDS.ownerA, tenantRole: "OWNER" as const, membershipRole: "OWNER" };

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
});

afterAll(async () => {
  await resetDatabase();
});

async function soldItem() {
  const sale = await createSale({
    tenantId: IDS.tenantA,
    storeId: IDS.storeA,
    cashierUserId: IDS.ownerA,
    idempotencyKey: randomUUID(),
    lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 2 }],
    payment: { method: "UPI" },
    correlationId: "c",
  });
  if (sale.status !== "ok") throw new Error(`sale failed: ${sale.status}`);
  const item = await db.saleItem.findFirstOrThrow({ where: { saleId: sale.sale.id } });
  return { saleId: sale.sale.id, itemId: item.id, unitMinor: Math.floor(sale.sale.totalMinor / 2) };
}

function refund(saleId: string, itemId: string, method: "CASH" | "UPI", amountMinor: number, posSessionId?: string | null) {
  return createReturn({
    tenantId: IDS.tenantA,
    storeId: IDS.storeA,
    actor: owner,
    originalSaleId: saleId,
    idempotencyKey: randomUUID(),
    items: [{ originalSaleItemId: itemId, quantity: 1 }],
    refundPayments: [{ method, amountMinor }],
    posSessionId,
  });
}

describe("return payout till (E7)", () => {
  it("a cash refund must name the till that pays it", async () => {
    const { saleId, itemId, unitMinor } = await soldItem();
    await expect(refund(saleId, itemId, "CASH", unitMinor)).rejects.toMatchObject({ code: "TILL_REQUIRED" });
  });

  it("records the paying till and the person, and the drawer's expected cash goes down", async () => {
    const { saleId, itemId, unitMinor } = await soldItem();
    const till = await openTestTill({ tenantId: IDS.tenantA, storeId: IDS.storeA, cashierUserId: IDS.ownerA, floatMinor: 500_000 });
    const res = await refund(saleId, itemId, "CASH", unitMinor, till);
    expect(res.saleReturn).toMatchObject({ posSessionId: till, processedByUserId: IDS.ownerA });
    const reg = (await getRegister({ tenantId: IDS.tenantA, sessionId: till }))!;
    expect(reg.refundedHere).toBe(unitMinor);
    expect(reg.expected.CASH).toBe(500_000 - unitMinor);
    // Attributed refunds no longer show as unattributed store refunds.
    expect(reg.storeCashRefundsMinor).toBe(0);
  });

  it("refuses a cash refund the drawer can't cover, and leaves nothing behind", async () => {
    const { saleId, itemId, unitMinor } = await soldItem();
    const till = await openTestTill({ tenantId: IDS.tenantA, storeId: IDS.storeA, cashierUserId: IDS.ownerA, floatMinor: unitMinor - 1 });
    await expect(refund(saleId, itemId, "CASH", unitMinor, till)).rejects.toMatchObject({ code: "CASH_SHORT" });
    expect(await db.saleReturn.count()).toBe(0);
  });

  it("a closed till, or another store's till, can't pay a refund", async () => {
    const { saleId, itemId, unitMinor } = await soldItem();
    const closed = await openTestTill({ tenantId: IDS.tenantA, storeId: IDS.storeA, cashierUserId: IDS.ownerA });
    await db.posSession.update({ where: { id: closed }, data: { closedAt: new Date() } });
    await expect(refund(saleId, itemId, "CASH", unitMinor, closed)).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const other = await openTestTill({ tenantId: IDS.tenantB, storeId: IDS.storeB, cashierUserId: IDS.ownerB, code: "B1" });
    await expect(refund(saleId, itemId, "CASH", unitMinor, other)).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("a UPI refund needs no till", async () => {
    const { saleId, itemId, unitMinor } = await soldItem();
    const plain = await refund(saleId, itemId, "UPI", unitMinor);
    expect(plain.saleReturn).toMatchObject({ posSessionId: null, processedByUserId: IDS.ownerA });
  });
});
