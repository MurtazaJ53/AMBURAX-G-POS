import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { GstTaxTreatment, TenantRole } from "@prisma/client";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS } from "./db";
import { createProduct, createVariant } from "@/server/catalog/catalogService";
import { buildInternalBarcode } from "@/server/catalog/barcodeGenerator";
import { backfillTenantBarcodes, countMissingBarcodes } from "@/server/catalog/barcodeBackfill";
import { isValidGtin } from "@/lib/gtin";

/**
 * Generated barcodes against real PostgreSQL: the per-tenant sequence row is what keeps
 * concurrent creates apart, and only a real database can show that it does.
 */

type Actor = { tenantId: string; userId: string; tenantRole: TenantRole };
const ACTOR_A: Actor = { tenantId: IDS.tenantA, userId: IDS.ownerA, tenantRole: TenantRole.OWNER };
const ACTOR_B: Actor = { tenantId: IDS.tenantB, userId: IDS.ownerB, tenantRole: TenantRole.OWNER };

function variantInput(actor: Actor, productId: string, sku: string, barcode: string | null = null) {
  return {
    actor,
    productId,
    sku,
    barcode,
    size: null,
    colour: null,
    priceMinor: 49900,
    mrpMinor: null,
    taxRateBp: 0,
    taxTreatment: GstTaxTreatment.NON_GST,
    isActive: true,
    correlationId: `test-${sku}`,
  };
}

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("generated barcodes", () => {
  it("gives concurrent creates distinct, valid, sequential EAN-13 codes", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => createVariant(variantInput(ACTOR_A, COMMERCE_IDS.productA, `SEQ-${i}`))),
    );
    const codes = results.map((r) => (r.status === "ok" ? r.barcode : `failed:${r.status}`));
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^21\d{11}$/);
      expect(isValidGtin(code!, 13)).toBe(true);
    }
    expect([...codes].sort()).toEqual(Array.from({ length: 10 }, (_, i) => buildInternalBarcode(i + 1)));

    const seq = await db.tenantBarcodeSequence.findUnique({ where: { tenantId: IDS.tenantA } });
    expect(Number(seq?.lastValue)).toBe(10);
    // Both stores of the barcode agree.
    const primaries = await db.variantBarcode.count({ where: { tenantId: IDS.tenantA, barcode: { in: codes as string[] }, isPrimary: true, type: "INTERNAL" } });
    expect(primaries).toBe(10);
  });

  it("numbers each tenant on its own", async () => {
    const a = await createVariant(variantInput(ACTOR_A, COMMERCE_IDS.productA, "OWN-A"));
    const b = await createVariant(variantInput(ACTOR_B, COMMERCE_IDS.productB, "OWN-B"));
    expect(a).toMatchObject({ status: "ok", barcode: buildInternalBarcode(1) });
    expect(b).toMatchObject({ status: "ok", barcode: buildInternalBarcode(1) });
  });

  it("skips a number that an existing code already uses", async () => {
    await db.productVariant.update({ where: { id: COMMERCE_IDS.variantA1 }, data: { barcode: buildInternalBarcode(1) } });
    const r = await createVariant(variantInput(ACTOR_A, COMMERCE_IDS.productA, "SKIP-1"));
    expect(r).toMatchObject({ status: "ok", barcode: buildInternalBarcode(2) });
  });

  it("gives every variant of a new product a code", async () => {
    const r = await createProduct({
      actor: ACTOR_A,
      name: "Barcode Kurta",
      isActive: true,
      correlationId: "test-product",
      variants: ["S", "M", "L"].map((size) => ({
        sku: `KURTA-${size}`,
        barcode: null,
        size,
        colour: null,
        priceMinor: 79900,
        mrpMinor: null,
        taxRateBp: 0,
        taxTreatment: GstTaxTreatment.NON_GST,
        isActive: true,
      })),
    } as Parameters<typeof createProduct>[0]);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.variants.map((v) => v.barcode)).toEqual([1, 2, 3].map(buildInternalBarcode));
  });

  it("keeps a typed supplier code as it is and does not draw a number for it", async () => {
    const r = await createVariant(variantInput(ACTOR_A, COMMERCE_IDS.productA, "SUP-1", "4006381333931"));
    expect(r).toMatchObject({ status: "ok", barcode: "4006381333931" });
    const row = await db.variantBarcode.findFirst({ where: { tenantId: IDS.tenantA, barcode: "4006381333931" } });
    expect(row?.type).toBe("EAN13");
    expect(await db.tenantBarcodeSequence.findUnique({ where: { tenantId: IDS.tenantA } })).toBeNull();
  });

  it("reports a barcode collision between concurrent creates as duplicate_barcode", async () => {
    const results = await Promise.all([
      createVariant(variantInput(ACTOR_A, COMMERCE_IDS.productA, "DUP-1", "8901234000021")),
      createVariant(variantInput(ACTOR_A, COMMERCE_IDS.productA, "DUP-2", "8901234000021")),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["duplicate_barcode", "ok"]);
  });
});

describe("barcode backfill", () => {
  it("fills every missing barcode once, writes no outbox event, and changes nothing on a re-run", async () => {
    await db.productVariant.updateMany({ where: { tenantId: IDS.tenantA }, data: { barcode: null } });
    await db.variantBarcode.deleteMany({ where: { tenantId: IDS.tenantA } });
    const missing = (await countMissingBarcodes(db, IDS.tenantA))[0]?.missing ?? 0;
    expect(missing).toBeGreaterThan(0);
    const outboxBefore = await db.outboxEvent.count();
    const tenantBBefore = await countMissingBarcodes(db, IDS.tenantB);

    const first = await backfillTenantBarcodes(db, IDS.tenantA, { batchSize: 1 });
    expect(first.assigned).toBe(missing);
    expect(await countMissingBarcodes(db, IDS.tenantA)).toEqual([]);

    const codes = await db.productVariant.findMany({ where: { tenantId: IDS.tenantA }, select: { barcode: true } });
    expect(new Set(codes.map((c) => c.barcode)).size).toBe(codes.length);
    expect(await db.variantBarcode.count({ where: { tenantId: IDS.tenantA, isPrimary: true } })).toBe(codes.length);

    const second = await backfillTenantBarcodes(db, IDS.tenantA);
    expect(second).toEqual({ assigned: 0, batches: 0 });
    expect(await db.outboxEvent.count()).toBe(outboxBefore);
    // Tenant B was not touched.
    expect(await countMissingBarcodes(db, IDS.tenantB)).toEqual(tenantBBefore);
  });
});
