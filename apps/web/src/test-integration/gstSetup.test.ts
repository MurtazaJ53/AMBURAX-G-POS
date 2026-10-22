import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS } from "./db";
import { bulkSetGst, countNeedingGst, gstinProblem, turnOnGst } from "@/server/catalog/gstSetup";
import { createSale } from "@/server/sales/saleService";

/** GST setup (owner 2026-10-16): mixed GST types on one bill, turning GST on later, bulk types. */

const owner = { tenantId: IDS.tenantA, userId: IDS.ownerA, tenantRole: "OWNER" as const };
const VALID_GSTIN = "24ABCDE1234F1Z6";

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
  await db.tenant.update({ where: { id: IDS.tenantA }, data: { taxId: null } });
});

afterAll(async () => {
  await resetDatabase();
});

function sell(lines: { variantId: string; quantity: number }[]) {
  return createSale({
    tenantId: IDS.tenantA,
    storeId: IDS.storeA,
    cashierUserId: IDS.ownerA,
    idempotencyKey: randomUUID(),
    lines,
    payment: { method: "CASH" },
    correlationId: "c",
  });
}

describe("GST setup", () => {
  it("checks a GSTIN's format, state code and check digit", () => {
    expect(gstinProblem(VALID_GSTIN)).toBeNull();
    expect(gstinProblem("24ABCDE1234F1Z5")).toMatch(/last character/);
    expect(gstinProblem("99ABCDE1234F1Z6")).toMatch(/state code/);
    expect(gstinProblem("hello")).toMatch(/15 characters/);
  });

  it("turning GST on makes 'no GST' products need a type, then a bulk type lets them sell", async () => {
    await db.productVariant.update({ where: { id: COMMERCE_IDS.variantA2 }, data: { taxTreatment: "NON_GST", taxRateBp: 0 } });

    expect((await turnOnGst({ actor: { ...owner, tenantRole: "STAFF" }, gstin: VALID_GSTIN })).status).toBe("forbidden");
    const on = await turnOnGst({ actor: owner, gstin: VALID_GSTIN });
    expect(on).toEqual({ status: "ok", needsReview: 1 });
    expect((await db.tenant.findUnique({ where: { id: IDS.tenantA } }))?.taxId).toBe(VALID_GSTIN);
    expect((await turnOnGst({ actor: owner, gstin: VALID_GSTIN })).status).toBe("already_registered");
    // The ERPNext Company is queued to receive the same GSTIN, once.
    expect(await db.outboxEvent.count({ where: { tenantId: IDS.tenantA, eventType: "TenantGstRegistered" } })).toBe(1);
    expect(await countNeedingGst(IDS.tenantA)).toBe(1);

    // Option A: it can't be sold until someone decides.
    expect((await sell([{ variantId: COMMERCE_IDS.variantA2, quantity: 1 }])).status).toBe("unresolved_tax_treatment");

    // Exempt needs its statutory reference.
    const noRef = await bulkSetGst({ actor: { ...owner, membershipRole: "OWNER" }, variantIds: [COMMERCE_IDS.variantA2], treatment: "EXEMPT" });
    expect(noRef.status).toBe("invalid");
    const set = await bulkSetGst({
      actor: { ...owner, membershipRole: "OWNER" },
      variantIds: [COMMERCE_IDS.variantA2],
      treatment: "NIL_RATED",
    });
    expect(set).toEqual({ status: "ok", updated: 1 });
    expect(await db.outboxEvent.count({ where: { entityId: COMMERCE_IDS.variantA2, eventType: "ProductVariantUpdated" } })).toBe(1);

    // One bill, a taxable line and a nil-rated line: GST only on the taxable one.
    const mixed = await sell([
      { variantId: COMMERCE_IDS.variantA1, quantity: 1 },
      { variantId: COMMERCE_IDS.variantA2, quantity: 1 },
    ]);
    expect(mixed.status).toBe("ok");
    if (mixed.status === "ok") {
      // Each line remembers its GST type for the receipt and ERPNext.
      const lines = await db.saleItem.findMany({ where: { saleId: mixed.sale.id }, select: { variantId: true, taxTreatment: true } });
      expect(Object.fromEntries(lines.map((l) => [l.variantId, l.taxTreatment]))).toEqual({
        [COMMERCE_IDS.variantA1]: "TAXABLE",
        [COMMERCE_IDS.variantA2]: "NIL_RATED",
      });
    }
    const taxable = await sell([{ variantId: COMMERCE_IDS.variantA1, quantity: 1 }]);
    if (mixed.status === "ok" && taxable.status === "ok") {
      expect(mixed.sale.taxMinor).toBe(taxable.sale.taxMinor);
      expect(mixed.sale.totalMinor).toBeGreaterThan(taxable.sale.totalMinor);
    }
  });
});
