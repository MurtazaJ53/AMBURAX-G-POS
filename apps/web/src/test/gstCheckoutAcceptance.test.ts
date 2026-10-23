import { describe, expect, it, vi, beforeEach } from "vitest";
import { GstTaxTreatment, TenantRole } from "@prisma/client";

// Mocks for all persistence, ledger, event outbox, and authorization boundaries.
// Guaranteed: no live database, Docker container, or ERPNext instance is contacted.

const mockTx = {
  store: {
    update: vi.fn(),
  },
  sale: {
    create: vi.fn(),
  },
  saleItem: {
    createMany: vi.fn(),
  },
  // createSale reads each line's weighted average cost inside the transaction; none recorded here.
  stockLevel: {
    findMany: vi.fn(async () => []),
  },
  // Decision 36: createSale checks active stock reservations; none exist here.
  $queryRaw: vi.fn(async () => [{ q: null }]),
};

const mockDb = {
  // A GST-registered business: NON_GST stays refused until reviewed GST decisions exist.
  tenant: {
    findUnique: vi.fn(async () => ({ taxId: "29AAAAA0000A1Z5" })),
  },
  sale: {
    findUnique: vi.fn(),
  },
  store: {
    findFirst: vi.fn(),
  },
  user: {
    findFirst: vi.fn(),
  },
  storeMembership: {
    findUnique: vi.fn(),
  },
  productVariant: {
    findMany: vi.fn(),
  },
  pendingPriceChange: {
    findMany: vi.fn(async () => []),
  },
  customer: {
    findFirst: vi.fn(),
  },
  $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
};

vi.mock("@/server/db", () => ({ db: mockDb }));
vi.mock("@/server/identity/audit", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/server/events/outbox", () => ({ enqueueOutboxEvent: vi.fn(async () => ({} as any)) }));
vi.mock("@/server/inventory/stockLedger", () => ({
  applyStockMovement: vi.fn(async () => {}),
  movementKey: { sale: (saleId: string, variantId: string) => `sale:${saleId}:${variantId}` },
}));
vi.mock("@/server/capability/capabilityService", () => ({
  requireCapability: vi.fn(async () => ({ status: "ok" })),
}));
vi.mock("@/server/pos/posSessionService", () => ({
  resolveSessionForSale: vi.fn(async () => ({ status: "ok", session: { id: "pos-sess-1" } })),
}));

const { createSale } = await import("@/server/sales/saleService");
const { writeAuditLog } = await import("@/server/identity/audit");
const { enqueueOutboxEvent } = await import("@/server/events/outbox");
const { applyStockMovement } = await import("@/server/inventory/stockLedger");

const TENANT_ID = "tenant-gst-1";
const STORE_ID = "store-gst-1";
const CASHIER_ID = "user-owner-1";

function defaultSaleInput(overrides: Partial<Parameters<typeof createSale>[0]> = {}): Parameters<typeof createSale>[0] {
  return {
    tenantId: TENANT_ID,
    storeId: STORE_ID,
    cashierUserId: CASHIER_ID,
    idempotencyKey: `idemp-${Date.now()}-${Math.random()}`,
    lines: [{ variantId: "var-polo-1", quantity: 1 }],
    payment: { method: "CASH", amountMinor: 79_900 },
    correlationId: "corr-gst-test",
    ...overrides,
  };
}

describe("GST Checkout Acceptance Tests (Offline Mocks)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockDb.sale.findUnique.mockResolvedValue(null);
    mockDb.store.findFirst.mockResolvedValue({ id: STORE_ID, code: "ST01" });
    mockDb.user.findFirst.mockResolvedValue({ tenantRole: TenantRole.OWNER });
    mockDb.storeMembership.findUnique.mockResolvedValue({ role: "MANAGER" });

    mockTx.store.update.mockResolvedValue({ code: "ST01", nextBillSeq: 101 });
    mockTx.sale.create.mockImplementation(async ({ data }: any) => ({
      id: "sale-gst-101",
      billNumber: "ST01-000100",
      totalMinor: data.totalMinor,
      subtotalMinor: data.subtotalMinor,
      taxMinor: data.taxMinor,
      discountMinor: data.discountMinor,
      paidMinor: data.paidMinor,
      erpSyncStatus: "PENDING",
      completedAt: new Date("2026-10-12T00:00:00Z"),
      payments: [{ status: "CONFIRMED" }],
    }));
    mockTx.saleItem.createMany.mockResolvedValue({ count: 1 });
  });

  describe("1. Unspecified GST Treatment Rejection", () => {
    it("refuses checkout when cart contains a variant with UNSPECIFIED tax treatment", async () => {
      mockDb.productVariant.findMany.mockResolvedValue([
        {
          id: "var-unspec-1",
          sku: "SYN-UNSPEC-001",
          priceMinor: 50_000,
          taxRateBp: 0,
          taxTreatment: GstTaxTreatment.UNSPECIFIED,
          isActive: true,
          product: { name: "Unclassified Polo" },
        },
      ]);

      const result = await createSale(
        defaultSaleInput({
          lines: [{ variantId: "var-unspec-1", quantity: 1 }],
          payment: { method: "CASH", amountMinor: 50_000 },
        }),
      );

      expect(result).toEqual({
        status: "unresolved_tax_treatment",
        variantId: "var-unspec-1",
      });

      // Proof: No database transaction, no sale persisted, no ledger posting, no outbox event
      expect(mockDb.$transaction).not.toHaveBeenCalled();
      expect(mockTx.sale.create).not.toHaveBeenCalled();
      expect(mockTx.saleItem.createMany).not.toHaveBeenCalled();
      expect(applyStockMovement).not.toHaveBeenCalled();
      expect(enqueueOutboxEvent).not.toHaveBeenCalled();
      expect(writeAuditLog).not.toHaveBeenCalled();
    });
  });

  describe("2. Non-Taxable Treatments Sell At Zero Tax (owner B3, 2026-10-16)", () => {
    const nonTaxable = [GstTaxTreatment.EXEMPT, GstTaxTreatment.ZERO_RATED, GstTaxTreatment.NON_GST] as const;

    it.each(nonTaxable)(
      "sells a %s variant with no GST, even if a rate is stored on it",
      async (taxTreatment) => {
        mockDb.productVariant.findMany.mockResolvedValue([
          {
            id: `var-${taxTreatment}`,
            sku: `SYN-${taxTreatment}-001`,
            priceMinor: 100_000,
            // A stale stored rate must never be charged on a non-taxable line.
            taxRateBp: 1800,
            taxTreatment,
            isActive: true,
            product: { name: `Item ${taxTreatment}` },
          },
        ]);

        const result = await createSale(
          defaultSaleInput({
            lines: [{ variantId: `var-${taxTreatment}`, quantity: 1 }],
            payment: { method: "CASH", amountMinor: 100_000 },
          }),
        );

        expect(result.status).toBe("ok");
        if (result.status === "ok") {
          expect(result.sale.taxMinor).toBe(0);
          expect(result.sale.totalMinor).toBe(100_000);
        }
      },
    );

    it("verifies service contract for NIL_RATED treatment handling", async () => {
      // In current saleService.ts (line 256), the unsupported guard checks:
      // variant.taxTreatment === "EXEMPT" || variant.taxTreatment === "ZERO_RATED" || variant.taxTreatment === "NON_GST"
      // NIL_RATED is not in that list and with taxRateBp = 0 passes through with 0 tax calculation.
      mockDb.productVariant.findMany.mockResolvedValue([
        {
          id: "var-nil-1",
          sku: "SYN-NIL-001",
          priceMinor: 45_000,
          taxRateBp: 0,
          taxTreatment: GstTaxTreatment.NIL_RATED,
          isActive: true,
          product: { name: "Nil Rated Item" },
        },
      ]);

      const result = await createSale(
        defaultSaleInput({
          lines: [{ variantId: "var-nil-1", quantity: 1 }],
          payment: { method: "CASH", amountMinor: 45_000 },
        }),
      );

      // Verifies actual behavior against current production source
      expect(result.status).toBe("ok");
      if (result.status === "ok") {
        expect(result.sale.taxMinor).toBe(0);
        expect(result.sale.subtotalMinor).toBe(45_000);
        expect(result.sale.totalMinor).toBe(45_000);
      }
    });
  });

  describe("3. Classified TAXABLE Variants Arithmetic & Exact Expected Totals", () => {
    it("correctly computes 5% GST (500 bp) for apparel under threshold (e.g. ₹799.00 polo shirt)", async () => {
      // Unit price: ₹799.00 = 79,900 paise. Quantity = 2.
      // Gross minor = 2 * 79,900 = 159,800 paise.
      // Integer tax formula: Math.round((159,800 * 500) / (10,000 + 500))
      // 159,800 * 500 / 10,500 = 7,609.5238... => rounded to 7,610 paise (₹76.10).
      // Subtotal net of tax = 159,800 - 7,610 = 152,190 paise (₹1,521.90).
      // Total payable = 159,800 paise (₹1,598.00).

      mockDb.productVariant.findMany.mockResolvedValue([
        {
          id: "var-polo-5pct",
          sku: "SYN-GAR-001",
          priceMinor: 79_900,
          taxRateBp: 500,
          taxTreatment: GstTaxTreatment.TAXABLE,
          isActive: true,
          product: { name: "Knitted Cotton Polo Shirt" },
        },
      ]);

      const result = await createSale(
        defaultSaleInput({
          lines: [{ variantId: "var-polo-5pct", quantity: 2 }],
          payment: { method: "CASH", amountMinor: 159_800 },
        }),
      );

      expect(result.status).toBe("ok");
      if (result.status !== "ok") throw new Error("Expected sale to succeed");

      expect(result.sale.totalMinor).toBe(159_800);
      expect(result.sale.taxMinor).toBe(7_610);
      expect(result.sale.subtotalMinor).toBe(152_190);
      expect(result.sale.discountMinor).toBe(0);
      expect(result.sale.paidMinor).toBe(159_800);

      // Verifies receipt invariant: subtotal + tax = total
      expect(result.sale.subtotalMinor + result.sale.taxMinor).toBe(result.sale.totalMinor);
      expect(Number.isInteger(result.sale.taxMinor)).toBe(true);
      expect(Number.isInteger(result.sale.subtotalMinor)).toBe(true);
      expect(Number.isInteger(result.sale.totalMinor)).toBe(true);
    });

    it("correctly computes 18% GST (1800 bp) for apparel over threshold (e.g. ₹3,499.00 blazer)", async () => {
      // Unit price: ₹3,499.00 = 349,900 paise. Quantity = 1.
      // Gross minor = 349,900 paise.
      // Integer tax formula: Math.round((349,900 * 1800) / (10,000 + 1800))
      // 349,900 * 1800 / 11,800 = 53,374.576... => rounded to 53,375 paise (₹533.75).
      // Subtotal net of tax = 349,900 - 53,375 = 296,525 paise (₹2,965.25).
      // Total payable = 349,900 paise (₹3,499.00).

      mockDb.productVariant.findMany.mockResolvedValue([
        {
          id: "var-blazer-18pct",
          sku: "SYN-GAR-002",
          priceMinor: 349_900,
          taxRateBp: 1800,
          taxTreatment: GstTaxTreatment.TAXABLE,
          isActive: true,
          product: { name: "Men's Woven Wool Blazer" },
        },
      ]);

      const result = await createSale(
        defaultSaleInput({
          lines: [{ variantId: "var-blazer-18pct", quantity: 1 }],
          payment: { method: "CARD", amountMinor: 349_900 },
        }),
      );

      expect(result.status).toBe("ok");
      if (result.status !== "ok") throw new Error("Expected sale to succeed");

      expect(result.sale.totalMinor).toBe(349_900);
      expect(result.sale.taxMinor).toBe(53_375);
      expect(result.sale.subtotalMinor).toBe(296_525);
      expect(result.sale.discountMinor).toBe(0);
      expect(result.sale.paidMinor).toBe(349_900);
      expect(result.sale.subtotalMinor + result.sale.taxMinor).toBe(result.sale.totalMinor);
    });

    // Owner rule 2026-10-13: discounts are allowed, but never without a reason.
    it("refuses a discount with no reason before any write", async () => {
      const result = await createSale(
        defaultSaleInput({
          lines: [
            { variantId: "var-polo-1", quantity: 2 },
            { variantId: "var-blazer-1", quantity: 1 },
          ],
          discountMinor: 10_000,
          payments: [
            { method: "CASH", amountMinor: 200_000 },
            { method: "UPI", amountMinor: 299_700 },
          ],
        }),
      );

      expect(result).toEqual({ status: "discount_not_allowed", reason: "Give a reason for the discount." });
      expect(mockDb.productVariant.findMany).not.toHaveBeenCalled();
      expect(mockDb.$transaction).not.toHaveBeenCalled();
      expect(mockTx.sale.create).not.toHaveBeenCalled();
      expect(mockTx.saleItem.createMany).not.toHaveBeenCalled();
      expect(applyStockMovement).not.toHaveBeenCalled();
      expect(enqueueOutboxEvent).not.toHaveBeenCalled();
      expect(writeAuditLog).not.toHaveBeenCalled();
    });

    it("computes multi-line mixed-rate cart (discounts are disabled, so none is applied)", async () => {
      // Line 1: 2 x Polo @ 79,900 = 159,800 gross, 500 bp => tax = 7,610, net = 152,190.
      // Line 2: 1 x Blazer @ 349,900 = 349,900 gross, 1800 bp => tax = 53,375, net = 296,525.
      // Total gross = 159,800 + 349,900 = 509,700 paise (₹5,097.00).
      // Total tax = 7,610 + 53,375 = 60,985 paise (₹609.85).
      // Net subtotal = 509,700 - 60,985 = 448,715 paise (₹4,487.15).
      // Total payable = 509,700 paise (₹5,097.00).

      mockDb.productVariant.findMany.mockResolvedValue([
        {
          id: "var-polo-1",
          sku: "SYN-GAR-001",
          priceMinor: 79_900,
          taxRateBp: 500,
          taxTreatment: GstTaxTreatment.TAXABLE,
          isActive: true,
          product: { name: "Polo Shirt" },
        },
        {
          id: "var-blazer-1",
          sku: "SYN-GAR-002",
          priceMinor: 349_900,
          taxRateBp: 1800,
          taxTreatment: GstTaxTreatment.TAXABLE,
          isActive: true,
          product: { name: "Wool Blazer" },
        },
      ]);

      const result = await createSale(
        defaultSaleInput({
          lines: [
            { variantId: "var-polo-1", quantity: 2 },
            { variantId: "var-blazer-1", quantity: 1 },
          ],
          discountMinor: 0,
          payments: [
            { method: "CASH", amountMinor: 200_000 },
            { method: "UPI", amountMinor: 309_700 },
          ],
        }),
      );

      expect(result.status).toBe("ok");
      if (result.status !== "ok") throw new Error("Expected sale to succeed");

      expect(result.sale.subtotalMinor).toBe(448_715);
      expect(result.sale.taxMinor).toBe(60_985);
      expect(result.sale.discountMinor).toBe(0);
      expect(result.sale.totalMinor).toBe(509_700);
      expect(result.sale.paidMinor).toBe(509_700);

      // Verify transaction persistence calls
      expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
      expect(mockTx.sale.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subtotalMinor: 448_715,
            taxMinor: 60_985,
            discountMinor: 0,
            totalMinor: 509_700,
            paidMinor: 509_700,
          }),
        }),
      );

      // Verify line items created with per-line snapshots
      expect(mockTx.saleItem.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            variantId: "var-polo-1",
            quantity: 2,
            unitPriceMinor: 79_900,
            taxRateBp: 500,
            taxMinor: 7_610,
            lineTotalMinor: 159_800,
          }),
          expect.objectContaining({
            variantId: "var-blazer-1",
            quantity: 1,
            unitPriceMinor: 349_900,
            taxRateBp: 1800,
            taxMinor: 53_375,
            lineTotalMinor: 349_900,
          }),
        ],
      });

      // Verify stock movement ledger entries for both variants
      expect(applyStockMovement).toHaveBeenCalledTimes(2);
      expect(applyStockMovement).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({ variantId: "var-polo-1", quantityDelta: -2, type: "SALE" }),
      );
      expect(applyStockMovement).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({ variantId: "var-blazer-1", quantityDelta: -1, type: "SALE" }),
      );

      // Verify outbox event creation with exact payload
      expect(enqueueOutboxEvent).toHaveBeenCalledTimes(1);
      expect(enqueueOutboxEvent).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({
          eventType: "SaleCompleted",
          payload: expect.objectContaining({
            subtotalMinor: 448_715,
            taxMinor: 60_985,
            discountMinor: 0,
            totalMinor: 509_700,
            lineCount: 2,
            paymentMethod: "SPLIT",
          }),
        }),
      );

      // Verify audit log
      expect(writeAuditLog).toHaveBeenCalledTimes(1);
      expect(result.sale.erpSyncStatus).toBe("PENDING");
    });
  });
});

