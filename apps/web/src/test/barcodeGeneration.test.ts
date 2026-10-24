import { describe, it, expect, vi, beforeEach } from "vitest";
import { GstTaxTreatment, TenantRole } from "@prisma/client";
import { gtinCheckDigit, isValidGtin } from "@/lib/gtin";

/**
 * In-store barcode generation without a database: the code format, the per-tenant sequence
 * as the generator sees it, supplier-code recognition, collision mapping, that every create
 * path asks for a code when none is given, and that the backfill is idempotent.
 * The real-PostgreSQL side (row lock, concurrent creates) is in
 * src/test-integration/barcodeSequence.test.ts.
 */

const mockTx = {
  product: { create: vi.fn() },
  productVariant: { create: vi.fn() },
};
const mockDb = {
  tenant: { findUnique: vi.fn(async () => ({ taxId: "29AABCU9603R1ZM" })) },
  uom: { findUnique: vi.fn() },
  product: { findUnique: vi.fn(async () => ({ id: "prod-1", tenantId: "t1", isDraft: false })) },
  productVariant: { findFirst: vi.fn(async () => null) },
  variantBarcode: { findFirst: vi.fn(async () => null) },
  $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
};
const mockNextTenantBarcode = vi.fn();
const mockSyncDualWrite = vi.fn(async () => {});
const mockSyncBarcode = vi.fn(async () => {});

vi.mock("@/server/db", () => ({ db: mockDb }));
vi.mock("@/server/identity/audit", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/server/events/outbox", () => ({ enqueueOutboxEvent: vi.fn(async () => ({})) }));
vi.mock("@/server/catalog/variantDualWrite", async (importActual) => ({
  ...(await importActual<typeof import("@/server/catalog/variantDualWrite")>()),
  syncVariantDualWrite: (...args: unknown[]) => mockSyncDualWrite(...(args as [])),
  syncVariantBarcode: (...args: unknown[]) => mockSyncBarcode(...(args as [])),
}));
vi.mock("@/server/catalog/barcodeGenerator", async (importActual) => ({
  ...(await importActual<typeof import("@/server/catalog/barcodeGenerator")>()),
  nextTenantBarcode: (...args: unknown[]) => mockNextTenantBarcode(...args),
}));

const { buildInternalBarcode } = await import("@/server/catalog/barcodeGenerator");
const realGenerator = await vi.importActual<typeof import("@/server/catalog/barcodeGenerator")>("@/server/catalog/barcodeGenerator");
const { inferBarcodeType, isDuplicateBarcodeError, isDuplicateSkuError, DuplicateBarcodeError } = await import(
  "@/server/catalog/variantDualWrite"
);
const { createProduct, createVariant } = await import("@/server/catalog/catalogService");
const { backfillTenantBarcodes } = await import("@/server/catalog/barcodeBackfill");

const ACTOR = { tenantId: "t1", userId: "u1", tenantRole: TenantRole.OWNER };
const VARIANT = {
  barcode: null,
  size: "M",
  colour: null,
  priceMinor: 49900,
  mrpMinor: null,
  taxRateBp: 0,
  taxTreatment: GstTaxTreatment.NON_GST,
  isActive: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  let seq = 0;
  mockNextTenantBarcode.mockImplementation(async () => buildInternalBarcode(++seq));
  mockTx.product.create.mockResolvedValue({ id: "prod-1", tenantId: "t1" });
  let n = 0;
  mockTx.productVariant.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: `var-${++n}`, ...data }));
});

describe("GTIN check digits", () => {
  it("matches published examples for EAN-13, UPC-A and EAN-8", () => {
    expect(gtinCheckDigit("400638133393")).toBe(1);
    expect(isValidGtin("4006381333931", 13)).toBe(true);
    expect(isValidGtin("036000291452", 12)).toBe(true);
    expect(isValidGtin("96385074", 8)).toBe(true);
    expect(isValidGtin("96385075", 8)).toBe(false);
    expect(isValidGtin("9638507A", 8)).toBe(false);
  });
});

describe("in-store barcode format", () => {
  it("is 21 + a 10-digit sequence + a valid check digit", () => {
    // 2·1 + 1·3 + 1·3 = 8, so the check digit is 2.
    expect(buildInternalBarcode(1)).toBe("2100000000012");
    for (const n of [1, 2, 99, 1234567, 9_999_999_999]) {
      const code = buildInternalBarcode(n);
      expect(code).toHaveLength(13);
      expect(code.startsWith("21")).toBe(true);
      expect(isValidGtin(code, 13)).toBe(true);
      expect(Number(code.slice(2, 12))).toBe(n);
    }
  });

  it("refuses numbers outside the 10-digit range", () => {
    expect(() => buildInternalBarcode(0)).toThrow();
    expect(() => buildInternalBarcode(10_000_000_000)).toThrow();
    expect(() => buildInternalBarcode(1.5)).toThrow();
  });
});

describe("nextTenantBarcode", () => {
  function fakeTx(taken: Set<string>) {
    let last = 0;
    return {
      $queryRaw: vi.fn(async () => [{ lastValue: BigInt(++last) }]),
      variantBarcode: { findFirst: vi.fn(async ({ where }: { where: { barcode: string } }) => (taken.has(where.barcode) ? { id: "x" } : null)) },
      productVariant: { findFirst: vi.fn(async () => null) },
    };
  }

  it("draws the next number from the tenant's sequence", async () => {
    const tx = fakeTx(new Set());
    expect(await realGenerator.nextTenantBarcode(tx as never, "t1")).toBe(buildInternalBarcode(1));
    expect(await realGenerator.nextTenantBarcode(tx as never, "t1")).toBe(buildInternalBarcode(2));
    // The upsert is scoped to the tenant it was asked for.
    expect(tx.$queryRaw.mock.calls[0]).toContain("t1");
  });

  it("skips numbers an existing code already uses", async () => {
    const tx = fakeTx(new Set([buildInternalBarcode(1), buildInternalBarcode(2)]));
    expect(await realGenerator.nextTenantBarcode(tx as never, "t1")).toBe(buildInternalBarcode(3));
  });
});

describe("supplier barcode recognition", () => {
  it("recognises EAN-13, UPC-A and EAN-8 by length and check digit", () => {
    expect(inferBarcodeType("4006381333931")).toBe("EAN13");
    expect(inferBarcodeType("036000291452")).toBe("UPC");
    expect(inferBarcodeType("96385074")).toBe("EAN8");
  });

  it("treats GS1 in-store numbers and older shop codes as internal", () => {
    expect(inferBarcodeType(buildInternalBarcode(5))).toBe("INTERNAL");
    expect(inferBarcodeType("20123451")).toBe("INTERNAL");
    expect(inferBarcodeType("BC-4 W-S-BLA-7184")).toBe("INTERNAL");
  });

  it("calls anything else a manufacturer code, including a bad check digit", () => {
    expect(inferBarcodeType("4006381333932")).toBe("MANUFACTURER");
    expect(inferBarcodeType("ABC-123")).toBe("MANUFACTURER");
  });
});

describe("unique violation mapping", () => {
  it("names a barcode collision as a barcode collision", () => {
    expect(isDuplicateBarcodeError({ code: "P2002", meta: { target: ["tenantId", "barcode"] } })).toBe(true);
    expect(isDuplicateBarcodeError({ code: "P2002", meta: { target: "variant_barcodes_tenantId_barcode_key" } })).toBe(true);
    expect(isDuplicateBarcodeError(new DuplicateBarcodeError("123"))).toBe(true);
    expect(isDuplicateBarcodeError({ code: "P2002", meta: { target: ["tenantId", "sku"] } })).toBe(false);
  });

  it("names a SKU collision as a SKU collision", () => {
    expect(isDuplicateSkuError({ code: "P2002", meta: { target: ["tenantId", "sku"] } })).toBe(true);
    expect(isDuplicateSkuError({ code: "P2002", meta: { target: "product_variants_tenantId_sku_key" } })).toBe(true);
    expect(isDuplicateSkuError({ code: "P2002", meta: { target: ["tenantId", "barcode"] } })).toBe(false);
  });

  it("createProduct reports a barcode P2002 as duplicate_barcode, not duplicate_product_name", async () => {
    mockTx.productVariant.create.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target: ["tenantId", "barcode"] } }),
    );
    const res = await createProduct({ actor: ACTOR, name: "Shirt", isActive: true, correlationId: "c", firstVariant: { ...VARIANT, sku: "S-1" } } as never);
    expect(res.status).toBe("duplicate_barcode");
  });

  it("createVariant reports a barcode P2002 as duplicate_barcode instead of throwing", async () => {
    mockTx.productVariant.create.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target: ["tenantId", "barcode"] } }),
    );
    const res = await createVariant({ actor: ACTOR, productId: "prod-1", sku: "V-1", correlationId: "c", ...VARIANT });
    expect(res.status).toBe("duplicate_barcode");
  });

  it("still reports a product name clash as duplicate_product_name", async () => {
    mockTx.product.create.mockRejectedValueOnce(
      Object.assign(new Error("product_unique_name_brand"), { code: "P2002", meta: { target: "product_unique_name_brand" } }),
    );
    const res = await createProduct({ actor: ACTOR, name: "Shirt", isActive: true, correlationId: "c", firstVariant: { ...VARIANT, sku: "S-1" } } as never);
    expect(res.status).toBe("duplicate_product_name");
  });
});

describe("every create path gets a code", () => {
  it("createProduct draws one per variant without a barcode, inside the transaction", async () => {
    const res = await createProduct({
      actor: ACTOR,
      name: "Kurta",
      isActive: true,
      correlationId: "c",
      variants: [
        { ...VARIANT, sku: "K-S", size: "S" },
        { ...VARIANT, sku: "K-M", size: "M", barcode: "4006381333931" },
        { ...VARIANT, sku: "K-L", size: "L" },
      ],
    } as never);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.variants.map((v) => v.barcode)).toEqual([buildInternalBarcode(1), "4006381333931", buildInternalBarcode(2)]);
    expect(mockNextTenantBarcode).toHaveBeenCalledTimes(2);
    expect(mockNextTenantBarcode).toHaveBeenCalledWith(mockTx, "t1");
    // The generated code is stored as INTERNAL; the supplier code keeps its own type.
    const types = mockSyncDualWrite.mock.calls.map((c) => (c as unknown as [unknown, { barcodeType?: string }])[1].barcodeType);
    expect(types[0]).toBe("INTERNAL");
    expect(types[2]).toBe("INTERNAL");
    expect(types[1]).not.toBe("INTERNAL");
  });

  it("createVariant draws one when none is given and returns it", async () => {
    const res = await createVariant({ actor: ACTOR, productId: "prod-1", sku: "V-1", correlationId: "c", ...VARIANT });
    expect(res).toEqual({ status: "ok", variantId: "var-1", barcode: buildInternalBarcode(1) });
  });

  it("createVariant keeps a typed or scanned code exactly as given", async () => {
    const res = await createVariant({ actor: ACTOR, productId: "prod-1", sku: "V-2", correlationId: "c", ...VARIANT, barcode: " 036000291452 " });
    expect(res).toMatchObject({ status: "ok", barcode: "036000291452" });
    expect(mockNextTenantBarcode).not.toHaveBeenCalled();
  });
});

describe("barcode backfill", () => {
  /** Variants in memory, with the same "only while still empty" write rule the real query has. */
  function fakeClient(rows: Array<{ id: string; barcode: string | null }>) {
    const tx = {
      productVariant: {
        updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: { barcode: string } }) => {
          const row = rows.find((r) => r.id === where.id && (r.barcode === null || r.barcode === ""));
          if (!row) return { count: 0 };
          row.barcode = data.barcode;
          return { count: 1 };
        }),
      },
    };
    return {
      tx,
      client: {
        productVariant: {
          findMany: vi.fn(async ({ take }: { take: number }) =>
            rows.filter((r) => r.barcode === null || r.barcode === "").slice(0, take).map((r) => ({ id: r.id })),
          ),
        },
        $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      },
    };
  }

  it("fills each missing barcode once and changes nothing on a second run", async () => {
    const rows = [
      { id: "a", barcode: null },
      { id: "b", barcode: "4006381333931" },
      { id: "c", barcode: "" },
      { id: "d", barcode: null },
    ];
    const { client } = fakeClient(rows);

    const first = await backfillTenantBarcodes(client as never, "t1", { batchSize: 2 });
    expect(first).toEqual({ assigned: 3, batches: 2 });
    expect(rows.map((r) => r.barcode)).toEqual([buildInternalBarcode(1), "4006381333931", buildInternalBarcode(2), buildInternalBarcode(3)]);
    expect(mockSyncBarcode).toHaveBeenCalledTimes(3);
    expect(mockSyncBarcode).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: "INTERNAL", tenantId: "t1" }));

    const second = await backfillTenantBarcodes(client as never, "t1", { batchSize: 2 });
    expect(second).toEqual({ assigned: 0, batches: 0 });
    expect(mockNextTenantBarcode).toHaveBeenCalledTimes(3);
  });

  it("stops instead of looping when nothing in a batch can be written", async () => {
    const rows = [{ id: "a", barcode: null }];
    const { client, tx } = fakeClient(rows);
    tx.productVariant.updateMany.mockResolvedValue({ count: 0 });
    const result = await backfillTenantBarcodes(client as never, "t1");
    expect(result).toEqual({ assigned: 0, batches: 1 });
  });
});
