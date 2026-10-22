import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { openTestTill } from "./till";
import { randomUUID } from "node:crypto";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS } from "./db";
import { createSale } from "@/server/sales/saleService";
import { createReturn } from "@/server/sales/returnService";
import { updateApparelSlab } from "@/server/tax/taxSettings";

/**
 * Owner rules 2026-10-13, end to end:
 * - a discount needs a reason; a cashier may give up to 10%, more needs a manager or owner;
 * - GST is extracted from the discounted amount; garment-slab variants pick 5% / 18% per piece;
 * - a return refunds what was actually paid for the units.
 *
 * Fixture variant A1 sells at Rs 1,000 at 5% (FIXED).
 */

const VARIANT = COMMERCE_IDS.variantA1;

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
  await db.storeMembership.create({
    data: { tenantId: IDS.tenantA, userId: IDS.staffA, storeId: IDS.storeA, role: "CASHIER" },
  });
});

afterAll(async () => {
  await resetDatabase();
});

function sell(params: {
  cashier: string;
  quantity?: number;
  discountMinor?: number;
  discountReason?: string | null;
  paid?: number;
}) {
  const qty = params.quantity ?? 1;
  return createSale({
    tenantId: IDS.tenantA,
    storeId: IDS.storeA,
    cashierUserId: params.cashier,
    idempotencyKey: randomUUID(),
    lines: [{ variantId: VARIANT, quantity: qty }],
    discountMinor: params.discountMinor,
    discountReason: params.discountReason,
    payment: { method: "CASH", amountMinor: params.paid },
    correlationId: "corr-discount",
  });
}

describe("bill discounts", () => {
  it("lets a cashier give 10% with a reason, and taxes the discounted amount", async () => {
    const res = await sell({ cashier: IDS.staffA, discountMinor: 10_000, discountReason: "Loyal customer" });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.sale.totalMinor).toBe(90_000);
    expect(res.sale.discountMinor).toBe(10_000);
    // 5% inclusive of Rs 900 = round(90000 * 500 / 10500) = 4286.
    expect(res.sale.taxMinor).toBe(4_286);

    const row = await db.sale.findUniqueOrThrow({ where: { id: res.sale.id } });
    expect(row).toMatchObject({ discountReason: "Loyal customer", discountAuthorisedByUserId: IDS.staffA });
    const line = await db.saleItem.findFirstOrThrow({ where: { saleId: res.sale.id } });
    expect(line).toMatchObject({ lineTotalMinor: 100_000, lineDiscountMinor: 10_000, taxMinor: 4_286 });
  });

  it("refuses a cashier's discount above 10%, and writes nothing", async () => {
    const res = await sell({ cashier: IDS.staffA, discountMinor: 10_001, discountReason: "Too generous" });
    expect(res.status).toBe("discount_not_allowed");
    expect(await db.sale.count()).toBe(0);
  });

  it("lets the owner give more than 10%", async () => {
    const res = await sell({ cashier: IDS.ownerA, discountMinor: 25_000, discountReason: "Damaged stitching" });
    expect(res.status).toBe("ok");
  });

  it("refuses any discount without a reason", async () => {
    expect((await sell({ cashier: IDS.ownerA, discountMinor: 1_000 })).status).toBe("discount_not_allowed");
    expect((await sell({ cashier: IDS.ownerA, discountMinor: 1_000, discountReason: "  " })).status).toBe(
      "discount_not_allowed",
    );
  });

  it("refuses a discount larger than the bill", async () => {
    const res = await sell({ cashier: IDS.ownerA, discountMinor: 100_001, discountReason: "Oops" });
    expect(res.status).toBe("validation_error");
  });

  it("refunds what was actually paid for a discounted unit", async () => {
    const sale = await sell({ cashier: IDS.ownerA, quantity: 2, discountMinor: 20_000, discountReason: "Pair offer" });
    if (sale.status !== "ok") throw new Error("sale failed");
    const item = await db.saleItem.findFirstOrThrow({ where: { saleId: sale.sale.id } });
    const ret = await createReturn({
      tenantId: IDS.tenantA,
      storeId: IDS.storeA,
      actor: { userId: IDS.ownerA, tenantRole: "OWNER", membershipRole: "OWNER" },
      posSessionId: await openTestTill({ tenantId: IDS.tenantA, storeId: IDS.storeA, cashierUserId: IDS.ownerA }),
      originalSaleId: sale.sale.id,
      idempotencyKey: randomUUID(),
      items: [{ originalSaleItemId: item.id, quantity: 1 }],
      refundPayments: [{ method: "CASH", amountMinor: 90_000 }],
    });
    expect(ret.saleReturn.totalRefundMinor).toBe(90_000);
  });
});

describe("garment GST slab", () => {
  beforeEach(async () => {
    await db.productVariant.update({
      where: { id: VARIANT },
      data: { taxRateMode: "APPAREL_SLAB", priceMinor: 280_000, mrpMinor: 300_000, taxRateBp: 1_800 },
    });
  });

  it("charges 18% on a piece above the limit and 5% once a discount brings it under", async () => {
    const full = await sell({ cashier: IDS.ownerA });
    if (full.status !== "ok") throw new Error("sale failed");
    expect((await db.saleItem.findFirstOrThrow({ where: { saleId: full.sale.id } })).taxRateBp).toBe(1_800);

    const discounted = await sell({ cashier: IDS.ownerA, discountMinor: 20_000, discountReason: "Season end" });
    if (discounted.status !== "ok") throw new Error("sale failed");
    const line = await db.saleItem.findFirstOrThrow({ where: { saleId: discounted.sale.id } });
    expect(line.taxRateBp).toBe(500);
    expect(line.taxMinor).toBe(Math.round((260_000 * 500) / 10_500));
  });

  it("follows the tenant's own slab settings", async () => {
    const changed = await updateApparelSlab({
      tenantId: IDS.tenantA,
      actorUserId: IDS.ownerA,
      tenantRole: "OWNER",
      slab: { thresholdMinor: 300_000, lowRateBp: 500, highRateBp: 1_800 },
    });
    expect(changed.status).toBe("ok");
    const res = await sell({ cashier: IDS.ownerA });
    if (res.status !== "ok") throw new Error("sale failed");
    expect((await db.saleItem.findFirstOrThrow({ where: { saleId: res.sale.id } })).taxRateBp).toBe(500);
  });

  it("only the owner may change the slab", async () => {
    const res = await updateApparelSlab({
      tenantId: IDS.tenantA,
      actorUserId: IDS.staffA,
      tenantRole: "STAFF",
      slab: { thresholdMinor: 1, lowRateBp: 500, highRateBp: 1_800 },
    });
    expect(res.status).toBe("forbidden");
  });
});
