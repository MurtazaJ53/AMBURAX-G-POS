import { describe, expect, it, vi, beforeEach } from "vitest";

// importProducts talks to Prisma and the catalogue/inventory services. All mocked: these tests
// prove what the import *sends* to createProduct and what it tells the owner about each row.

const mockDb = {
  uom: { findFirst: vi.fn() },
  tenant: { findUnique: vi.fn() },
  productVariant: { findFirst: vi.fn() },
  product: { findFirst: vi.fn() },
};
vi.mock("@/server/db", () => ({ db: mockDb }));
vi.mock("@/server/identity/audit", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/server/sales/customers", () => ({ createCustomer: vi.fn() }));
vi.mock("@/server/inventory/inventoryService", () => ({ receiveStock: vi.fn(async () => ({ status: "ok" })) }));
vi.mock("@/server/catalog/catalogService", () => ({
  createProduct: vi.fn(async () => ({ status: "ok", productId: "p1", variantId: "v1" })),
  createVariant: vi.fn(async () => ({ status: "ok", variantId: "v2" })),
}));

const { runImport } = await import("@/server/imports/importService");
const { createProduct } = await import("@/server/catalog/catalogService");

const actor = { tenantId: "t1", userId: "u1", tenantRole: "OWNER" as const };

function importRows(rows: Record<string, string>[]) {
  return runImport({ actor, storeId: "s1", kind: "products", batchId: "batch-1234", firstRowNumber: 2, rows });
}

function sentFirstVariant(call = 0) {
  return (vi.mocked(createProduct).mock.calls[call]![0] as unknown as { firstVariant: Record<string, unknown> }).firstVariant;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.uom.findFirst.mockResolvedValue({ id: "uom-pcs" });
  mockDb.productVariant.findFirst.mockResolvedValue(null);
  mockDb.product.findFirst.mockResolvedValue(null);
});

describe("product import", () => {
  describe("bug 9: a shop without a GSTIN", () => {
    beforeEach(() => mockDb.tenant.findUnique.mockResolvedValue({ taxId: null }));

    it("imports rows with no GST columns as non-GST", async () => {
      const res = await importRows([{ name: "Socks", price: "149" }]);
      expect(res).toMatchObject({ status: "ok", outcome: { created: 1, errors: [] } });
      expect(sentFirstVariant()).toMatchObject({ taxTreatment: "NON_GST", taxRateBp: 0 });
    });

    it("explains in a sentence why a GST % can't be imported", async () => {
      const res = await importRows([{ name: "Shirt", price: "999", gstRate: "5" }]);
      expect(res.status).toBe("ok");
      const err = (res as { outcome: { errors: { reason: string }[] } }).outcome.errors[0]!;
      expect(err.reason).toMatch(/GSTIN/);
      expect(err.reason).not.toMatch(/invalid_tax_classification/);
      expect(createProduct).not.toHaveBeenCalled();
    });
  });

  describe("a GST-registered shop", () => {
    beforeEach(() => mockDb.tenant.findUnique.mockResolvedValue({ taxId: "27AAAPL1234C1ZV" }));

    it("still never guesses GST: a row without it is refused in a sentence", async () => {
      const res = await importRows([{ name: "Socks", price: "149" }]);
      const err = (res as { outcome: { errors: { reason: string }[] } }).outcome.errors[0]!;
      expect(err.reason).toMatch(/GST/);
      expect(err.reason).not.toMatch(/[a-z]+_[a-z]+/);
      expect(createProduct).not.toHaveBeenCalled();
    });

    it("imports a row with a GST %", async () => {
      await importRows([{ name: "Shirt", price: "999", gstRate: "5" }]);
      expect(sentFirstVariant()).toMatchObject({ taxTreatment: "TAXABLE", taxRateBp: 500 });
    });
  });

  it("turns a refused product into a sentence, never a raw status code", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({ taxId: null });
    vi.mocked(createProduct).mockResolvedValueOnce({ status: "invalid_tax_classification" } as never);
    const res = await importRows([{ name: "Socks", price: "149" }]);
    const err = (res as { outcome: { errors: { reason: string }[] } }).outcome.errors[0]!;
    expect(err.reason).not.toMatch(/invalid_tax_classification|Couldn't add \(/);
  });
});
