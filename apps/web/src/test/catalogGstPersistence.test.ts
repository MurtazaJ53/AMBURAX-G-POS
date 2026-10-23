import { describe, expect, it, vi, beforeEach } from "vitest";
import { GstTaxTreatment, TenantRole } from "@prisma/client";
import { NextRequest } from "next/server";

// Isolated mocks for database persistence, audit, and event outbox.
// Guaranteed: no real database, Docker container, or ERP instance is contacted.

const mockTx = {
  product: {
    create: vi.fn(),
  },
  productVariant: {
    create: vi.fn(),
    update: vi.fn(),
  },
  // updateVariant cancels prices queued behind older stock when the price changes.
  pendingPriceChange: {
    updateMany: vi.fn(),
  },
};

const mockDb = {
  uom: {
    findUnique: vi.fn(),
  },
  product: {
    findUnique: vi.fn(),
  },
  productVariant: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  variantBarcode: {
    findFirst: vi.fn(async () => null),
  },
  $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
};

const mockResolvePosContext = vi.fn();

vi.mock("@/server/db", () => ({ db: mockDb }));
vi.mock("@/server/identity/audit", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/server/events/outbox", () => ({ enqueueOutboxEvent: vi.fn(async () => ({} as any)) }));
vi.mock("@/server/sales/posContext", () => ({
  resolvePosContext: (...args: unknown[]) => mockResolvePosContext(...args),
}));

vi.mock("@/server/catalog/variantDualWrite", () => ({
  syncVariantDualWrite: vi.fn(async () => {}),
  ensureSystemAttributeDefinitions: vi.fn(async () => ({ sizeDefId: "s", colourDefId: "c" })),
}));
vi.mock("@/server/catalog/barcodeGenerator", () => ({
  generateUniqueShortBarcode: vi.fn(async () => "12345678"),
}));

const { createProduct, createVariant, updateVariant } = await import("@/server/catalog/catalogService");
const { POST: postProductRoute } = await import("@/app/api/v1/catalog/products/route");
const { POST: postVariantRoute } = await import("@/app/api/v1/catalog/products/[id]/variants/route");
const { PUT: putVariantRoute } = await import("@/app/api/v1/catalog/variants/[id]/route");
const { env } = await import("@/lib/env");

const TENANT_ID = "tenant-catalog-gst-1";
const USER_ID = "user-owner-1";
const ACTOR = {
  tenantId: TENANT_ID,
  userId: USER_ID,
  tenantRole: TenantRole.OWNER,
};

function makeNextRequest(url: string, method: string, body?: unknown) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    cookie: `${env.SESSION_COOKIE_NAME}=test-session-token`,
  };
  return new NextRequest(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("Catalog GST Treatment Persistence & Validation (Offline)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockDb.uom.findUnique.mockResolvedValue({ id: "uom-pcs", tenantId: TENANT_ID });
    mockDb.product.findUnique.mockResolvedValue({ id: "prod-1", tenantId: TENANT_ID });
    mockDb.productVariant.findFirst.mockResolvedValue(null);

    mockTx.product.create.mockResolvedValue({
      id: "prod-1",
      tenantId: TENANT_ID,
      name: "Formal Shirt",
    });

    mockTx.productVariant.create.mockImplementation(async ({ data }: any) => ({
      id: "var-1",
      ...data,
    }));

    mockTx.productVariant.update.mockImplementation(async ({ data }: any) => ({
      id: "var-1",
      ...data,
    }));

    mockResolvePosContext.mockResolvedValue({
      status: "ok",
      context: {
        tenantId: TENANT_ID,
        userId: USER_ID,
        tenantRole: TenantRole.OWNER,
        storeId: "store-1",
      },
    });
  });

  // ---------------------------------------------------------------------------
  // 1. Domain Service: createProduct
  // ---------------------------------------------------------------------------
  describe("createProduct", () => {
    it("validates and passes TAXABLE treatment and positive taxRateBp to persistence unchanged", async () => {
      const res = await createProduct({
        actor: ACTOR,
        name: "Linen Shirt",
        category: "Apparel",
        brand: "Amburax",
        isActive: true,
        baseUomId: "uom-pcs",
        correlationId: "corr-1",
        firstVariant: {
          sku: "LINEN-S",
          barcode: null,
          size: "S",
          colour: "White",
          priceMinor: 149900,
          mrpMinor: 199900,
          taxRateBp: 1800,
          taxTreatment: GstTaxTreatment.TAXABLE,
          taxExemptionRef: null,
          isActive: true,
        },
      });

      expect(res.status).toBe("ok");
      expect(mockTx.productVariant.create).toHaveBeenCalledTimes(1);
      expect(mockTx.productVariant.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          sku: "LINEN-S",
          taxRateBp: 1800,
          taxTreatment: GstTaxTreatment.TAXABLE,
          taxExemptionRef: null,
        }),
      });
    });

    it("validates and passes EXEMPT treatment with non-empty statutory reference unchanged", async () => {
      const res = await createProduct({
        actor: ACTOR,
        name: "Handloom Cotton Khadi",
        category: "Handloom",
        brand: null,
        isActive: true,
        baseUomId: "uom-pcs",
        correlationId: "corr-2",
        firstVariant: {
          sku: "KHADI-01",
          barcode: null,
          size: null,
          colour: null,
          priceMinor: 50000,
          mrpMinor: null,
          taxRateBp: 0,
          taxTreatment: GstTaxTreatment.EXEMPT,
          taxExemptionRef: "Notification No. 02/2017-Central Tax (Rate)",
          isActive: true,
        },
      });

      expect(res.status).toBe("ok");
      expect(mockTx.productVariant.create).toHaveBeenCalledTimes(1);
      expect(mockTx.productVariant.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          taxRateBp: 0,
          taxTreatment: GstTaxTreatment.EXEMPT,
          taxExemptionRef: "Notification No. 02/2017-Central Tax (Rate)",
        }),
      });
    });

    it("validates and passes NIL_RATED treatment with zero rate unchanged", async () => {
      const res = await createProduct({
        actor: ACTOR,
        name: "Salt Pack",
        category: "Grocery",
        brand: null,
        isActive: true,
        baseUomId: "uom-pcs",
        correlationId: "corr-3",
        firstVariant: {
          sku: "SALT-1KG",
          barcode: null,
          size: "1kg",
          colour: null,
          priceMinor: 2000,
          mrpMinor: 2000,
          taxRateBp: 0,
          taxTreatment: GstTaxTreatment.NIL_RATED,
          taxExemptionRef: null,
          isActive: true,
        },
      });

      expect(res.status).toBe("ok");
      expect(mockTx.productVariant.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          taxRateBp: 0,
          taxTreatment: GstTaxTreatment.NIL_RATED,
          taxExemptionRef: null,
        }),
      });
    });

    it("rejects EXEMPT without a statutory reference before persistence", async () => {
      const resNull = await createProduct({
        actor: ACTOR,
        name: "Exempt Item",
        category: null,
        brand: null,
        isActive: true,
        baseUomId: "uom-pcs",
        correlationId: "corr-4",
        firstVariant: {
          sku: "EX-01",
          barcode: null,
          size: null,
          colour: null,
          priceMinor: 1000,
          mrpMinor: null,
          taxRateBp: 0,
          taxTreatment: GstTaxTreatment.EXEMPT,
          taxExemptionRef: null,
          isActive: true,
        },
      });

      expect(resNull).toEqual({ status: "invalid_tax_classification" });
      expect(mockDb.$transaction).not.toHaveBeenCalled();
      expect(mockTx.productVariant.create).not.toHaveBeenCalled();

      const resEmpty = await createProduct({
        actor: ACTOR,
        name: "Exempt Item 2",
        category: null,
        brand: null,
        isActive: true,
        baseUomId: "uom-pcs",
        correlationId: "corr-5",
        firstVariant: {
          sku: "EX-02",
          barcode: null,
          size: null,
          colour: null,
          priceMinor: 1000,
          mrpMinor: null,
          taxRateBp: 0,
          taxTreatment: GstTaxTreatment.EXEMPT,
          taxExemptionRef: "   ",
          isActive: true,
        },
      });

      expect(resEmpty).toEqual({ status: "invalid_tax_classification" });
      expect(mockTx.productVariant.create).not.toHaveBeenCalled();
    });

    it("rejects non-EXEMPT treatments with an exemption reference before persistence", async () => {
      const nonExemptTreatments = [
        GstTaxTreatment.TAXABLE,
        GstTaxTreatment.NIL_RATED,
        GstTaxTreatment.ZERO_RATED,
        GstTaxTreatment.NON_GST,
        GstTaxTreatment.UNSPECIFIED,
      ];

      for (const treatment of nonExemptTreatments) {
        const res = await createProduct({
          actor: ACTOR,
          name: "Item",
          category: null,
          brand: null,
          isActive: true,
          baseUomId: "uom-pcs",
          correlationId: `corr-non-exempt-${treatment}`,
          firstVariant: {
            sku: `SKU-${treatment}`,
            barcode: null,
            size: null,
            colour: null,
            priceMinor: 1000,
            mrpMinor: null,
            taxRateBp: treatment === GstTaxTreatment.TAXABLE ? 1800 : 0,
            taxTreatment: treatment,
            taxExemptionRef: "Notification No. 02/2017",
            isActive: true,
          },
        });

        expect(res).toEqual({ status: "invalid_tax_classification" });
        expect(mockTx.productVariant.create).not.toHaveBeenCalled();
      }
    });

    it("rejects TAXABLE treatment with zero taxRateBp before persistence", async () => {
      const res = await createProduct({
        actor: ACTOR,
        name: "Taxable Zero Rate",
        category: null,
        brand: null,
        isActive: true,
        baseUomId: "uom-pcs",
        correlationId: "corr-tax-zero",
        firstVariant: {
          sku: "ZERO-TAX",
          barcode: null,
          size: null,
          colour: null,
          priceMinor: 1000,
          mrpMinor: null,
          taxRateBp: 0,
          taxTreatment: GstTaxTreatment.TAXABLE,
          taxExemptionRef: null,
          isActive: true,
        },
      });

      expect(res).toEqual({ status: "invalid_tax_classification" });
      expect(mockDb.$transaction).not.toHaveBeenCalled();
      expect(mockTx.productVariant.create).not.toHaveBeenCalled();
    });

    it("rejects non-TAXABLE treatment with positive taxRateBp before persistence", async () => {
      const res = await createProduct({
        actor: ACTOR,
        name: "Nil Rated Positive Rate",
        category: null,
        brand: null,
        isActive: true,
        baseUomId: "uom-pcs",
        correlationId: "corr-nil-pos",
        firstVariant: {
          sku: "NIL-POS",
          barcode: null,
          size: null,
          colour: null,
          priceMinor: 1000,
          mrpMinor: null,
          taxRateBp: 500,
          taxTreatment: GstTaxTreatment.NIL_RATED,
          taxExemptionRef: null,
          isActive: true,
        },
      });

      expect(res).toEqual({ status: "invalid_tax_classification" });
      expect(mockTx.productVariant.create).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Domain Service: createVariant
  // ---------------------------------------------------------------------------
  describe("createVariant", () => {
    it("validates and passes tax treatment and statutory reference unchanged", async () => {
      const res = await createVariant({
        actor: ACTOR,
        productId: "prod-1",
        sku: "VAR-EXEMPT-2",
        barcode: null,
        size: "M",
        colour: "Blue",
        priceMinor: 89900,
        mrpMinor: null,
        taxRateBp: 0,
        taxTreatment: GstTaxTreatment.EXEMPT,
        taxExemptionRef: "Notification No. 12/2017-Central Tax (Rate)",
        isActive: true,
        correlationId: "corr-var-1",
      });

      expect(res.status).toBe("ok");
      expect(mockTx.productVariant.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: TENANT_ID,
          productId: "prod-1",
          sku: "VAR-EXEMPT-2",
          taxRateBp: 0,
          taxTreatment: GstTaxTreatment.EXEMPT,
          taxExemptionRef: "Notification No. 12/2017-Central Tax (Rate)",
        }),
      });
    });

    it("rejects invalid GST classification before variant persistence", async () => {
      const res = await createVariant({
        actor: ACTOR,
        productId: "prod-1",
        sku: "VAR-BAD-TAX",
        barcode: null,
        size: null,
        colour: null,
        priceMinor: 89900,
        mrpMinor: null,
        taxRateBp: 1200,
        taxTreatment: GstTaxTreatment.EXEMPT,
        taxExemptionRef: "Ref 12/2017",
        isActive: true,
        correlationId: "corr-var-bad",
      });

      expect(res).toEqual({ status: "invalid_tax_classification" });
      expect(mockTx.productVariant.create).not.toHaveBeenCalled();
    });

    it("preserves tenant isolation: refuses product lookup belonging to another tenant", async () => {
      mockDb.product.findUnique.mockResolvedValue(null);

      const res = await createVariant({
        actor: ACTOR,
        productId: "foreign-prod-999",
        sku: "VAR-FOREIGN",
        barcode: null,
        size: null,
        colour: null,
        priceMinor: 1000,
        mrpMinor: null,
        taxRateBp: 1800,
        taxTreatment: GstTaxTreatment.TAXABLE,
        taxExemptionRef: null,
        isActive: true,
        correlationId: "corr-var-foreign",
      });

      expect(mockDb.product.findUnique).toHaveBeenCalledWith({
        where: { id_tenantId: { id: "foreign-prod-999", tenantId: TENANT_ID } },
      });
      expect(res).toEqual({ status: "not_found" });
      expect(mockTx.productVariant.create).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Domain Service: updateVariant
  // ---------------------------------------------------------------------------
  describe("updateVariant", () => {
    it("updates taxTreatment, taxRateBp, and taxExemptionRef unchanged when classification is valid", async () => {
      mockDb.productVariant.findUnique.mockResolvedValue({
        id: "var-1",
        tenantId: TENANT_ID,
        sku: "VAR-1",
        taxRateBp: 0,
        taxTreatment: GstTaxTreatment.UNSPECIFIED,
        taxExemptionRef: null,
      });

      const res = await updateVariant({
        actor: ACTOR,
        variantId: "var-1",
        taxRateBp: 1800,
        taxTreatment: GstTaxTreatment.TAXABLE,
        taxExemptionRef: null,
        correlationId: "corr-update-1",
      });

      expect(res).toEqual({ status: "ok" });
      expect(mockTx.productVariant.update).toHaveBeenCalledTimes(1);
      expect(mockTx.productVariant.update).toHaveBeenCalledWith({
        where: { id: "var-1", tenantId: TENANT_ID },
        data: expect.objectContaining({
          taxRateBp: 1800,
          taxTreatment: GstTaxTreatment.TAXABLE,
          taxExemptionRef: null,
        }),
      });
    });

    it("updates to EXEMPT with a valid statutory reference unchanged", async () => {
      mockDb.productVariant.findUnique.mockResolvedValue({
        id: "var-2",
        tenantId: TENANT_ID,
        sku: "VAR-2",
        taxRateBp: 1800,
        taxTreatment: GstTaxTreatment.TAXABLE,
        taxExemptionRef: null,
      });

      const res = await updateVariant({
        actor: ACTOR,
        variantId: "var-2",
        taxRateBp: 0,
        taxTreatment: GstTaxTreatment.EXEMPT,
        taxExemptionRef: "Schedule I Entry 45",
        correlationId: "corr-update-exempt",
      });

      expect(res).toEqual({ status: "ok" });
      expect(mockTx.productVariant.update).toHaveBeenCalledWith({
        where: { id: "var-2", tenantId: TENANT_ID },
        data: expect.objectContaining({
          taxRateBp: 0,
          taxTreatment: GstTaxTreatment.EXEMPT,
          taxExemptionRef: "Schedule I Entry 45",
        }),
      });
    });

    it("preserves existing tax treatment and statutory reference when omitted during partial update", async () => {
      mockDb.productVariant.findUnique.mockResolvedValue({
        id: "var-3",
        tenantId: TENANT_ID,
        sku: "VAR-3",
        priceMinor: 10000,
        taxRateBp: 1200,
        taxTreatment: GstTaxTreatment.TAXABLE,
        taxExemptionRef: null,
      });

      const res = await updateVariant({
        actor: ACTOR,
        variantId: "var-3",
        priceMinor: 12500,
        correlationId: "corr-update-partial",
      });

      expect(res).toEqual({ status: "ok" });
      expect(mockTx.productVariant.update).toHaveBeenCalledWith({
        where: { id: "var-3", tenantId: TENANT_ID },
        data: expect.objectContaining({
          priceMinor: 12500,
          taxRateBp: 1200,
          taxTreatment: GstTaxTreatment.TAXABLE,
          taxExemptionRef: null,
        }),
      });
    });

    it("rejects update to EXEMPT without a non-empty statutory reference before persistence", async () => {
      mockDb.productVariant.findUnique.mockResolvedValue({
        id: "var-4",
        tenantId: TENANT_ID,
        sku: "VAR-4",
        taxRateBp: 0,
        taxTreatment: GstTaxTreatment.UNSPECIFIED,
        taxExemptionRef: null,
      });

      const res = await updateVariant({
        actor: ACTOR,
        variantId: "var-4",
        taxRateBp: 0,
        taxTreatment: GstTaxTreatment.EXEMPT,
        taxExemptionRef: "",
        correlationId: "corr-update-bad-exempt",
      });

      expect(res).toEqual({ status: "invalid_tax_classification" });
      expect(mockTx.productVariant.update).not.toHaveBeenCalled();
    });

    it("rejects update giving exemption reference to a non-EXEMPT treatment before persistence", async () => {
      mockDb.productVariant.findUnique.mockResolvedValue({
        id: "var-5",
        tenantId: TENANT_ID,
        sku: "VAR-5",
        taxRateBp: 0,
        taxTreatment: GstTaxTreatment.UNSPECIFIED,
        taxExemptionRef: null,
      });

      const res = await updateVariant({
        actor: ACTOR,
        variantId: "var-5",
        taxRateBp: 1800,
        taxTreatment: GstTaxTreatment.TAXABLE,
        taxExemptionRef: "Notif 02/2017",
        correlationId: "corr-update-tax-with-ref",
      });

      expect(res).toEqual({ status: "invalid_tax_classification" });
      expect(mockTx.productVariant.update).not.toHaveBeenCalled();
    });

    it("rejects inconsistent taxRateBp during update before persistence", async () => {
      mockDb.productVariant.findUnique.mockResolvedValue({
        id: "var-6",
        tenantId: TENANT_ID,
        sku: "VAR-6",
        taxRateBp: 0,
        taxTreatment: GstTaxTreatment.UNSPECIFIED,
        taxExemptionRef: null,
      });

      const res = await updateVariant({
        actor: ACTOR,
        variantId: "var-6",
        taxRateBp: 0,
        taxTreatment: GstTaxTreatment.TAXABLE,
        correlationId: "corr-update-zero-taxable",
      });

      expect(res).toEqual({ status: "invalid_tax_classification" });
      expect(mockTx.productVariant.update).not.toHaveBeenCalled();
    });

    it("preserves tenant-scoped update behavior: refuses variant belonging to another tenant", async () => {
      // findUnique returns null when queried with a mismatched tenantId
      mockDb.productVariant.findUnique.mockResolvedValue(null);

      const res = await updateVariant({
        actor: ACTOR,
        variantId: "foreign-var-888",
        taxRateBp: 1800,
        taxTreatment: GstTaxTreatment.TAXABLE,
        correlationId: "corr-update-foreign",
      });

      expect(mockDb.productVariant.findUnique).toHaveBeenCalledWith({
        where: { id: "foreign-var-888", tenantId: TENANT_ID },
      });
      expect(res).toEqual({ status: "not_found" });
      expect(mockDb.$transaction).not.toHaveBeenCalled();
      expect(mockTx.productVariant.update).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 4. HTTP API Routes: Boundary Validation & Persistence Delivery
  // ---------------------------------------------------------------------------
  describe("Catalog API Routes Boundary Validation", () => {
    it("POST /api/v1/catalog/products validates and passes GST fields to persistence", async () => {
      const req = makeNextRequest("http://localhost/api/v1/catalog/products", "POST", {
        name: "Route Test Product",
        category: "Test",
        baseUomId: "uom-pcs",
        variant: {
          sku: "ROUTE-SKU-1",
          priceMinor: 99900,
          taxRateBp: 1800,
          taxTreatment: "TAXABLE",
          taxExemptionRef: null,
        },
      });

      const res = await postProductRoute(req);
      expect(res.status).toBe(201);
      expect(mockTx.productVariant.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sku: "ROUTE-SKU-1",
          taxRateBp: 1800,
          taxTreatment: GstTaxTreatment.TAXABLE,
          taxExemptionRef: null,
        }),
      });
    });

    it("POST /api/v1/catalog/products rejects EXEMPT without statutory reference with HTTP 400 before persistence", async () => {
      const req = makeNextRequest("http://localhost/api/v1/catalog/products", "POST", {
        name: "Invalid Exempt",
        baseUomId: "uom-pcs",
        variant: {
          sku: "ROUTE-SKU-BAD-EX",
          priceMinor: 50000,
          taxRateBp: 0,
          taxTreatment: "EXEMPT",
          taxExemptionRef: null,
        },
      });

      const res = await postProductRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("validation_error");
      expect(json.error.message).toMatch(/statutory reference/i);
      expect(mockTx.productVariant.create).not.toHaveBeenCalled();
    });

    it("POST /api/v1/catalog/products rejects TAXABLE with statutory reference with HTTP 400 before persistence", async () => {
      const req = makeNextRequest("http://localhost/api/v1/catalog/products", "POST", {
        name: "Taxable with Exemption Ref",
        baseUomId: "uom-pcs",
        variant: {
          sku: "ROUTE-SKU-BAD-TAX",
          priceMinor: 50000,
          taxRateBp: 1800,
          taxTreatment: "TAXABLE",
          taxExemptionRef: "Notif 02/2017",
        },
      });

      const res = await postProductRoute(req);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("validation_error");
      expect(mockTx.productVariant.create).not.toHaveBeenCalled();
    });

    it("POST /api/v1/catalog/products/[id]/variants rejects EXEMPT without statutory reference with HTTP 400", async () => {
      const req = makeNextRequest("http://localhost/api/v1/catalog/products/prod-1/variants", "POST", {
        sku: "SUB-VAR-BAD-EX",
        priceMinor: 30000,
        taxRateBp: 0,
        taxTreatment: "EXEMPT",
        taxExemptionRef: null,
      });

      const res = await postVariantRoute(req, { params: Promise.resolve({ id: "prod-1" }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("validation_error");
      expect(mockTx.productVariant.create).not.toHaveBeenCalled();
    });

    it("PUT /api/v1/catalog/variants/[id] rejects changing taxRateBp without explicit taxTreatment with HTTP 400", async () => {
      const req = makeNextRequest("http://localhost/api/v1/catalog/variants/var-1", "PUT", {
        taxRateBp: 1800,
        // taxTreatment deliberately omitted
      });

      const res = await putVariantRoute(req, { params: Promise.resolve({ id: "var-1" }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("validation_error");
      expect(json.error.message).toMatch(/explicit tax treatment/i);
      expect(mockTx.productVariant.update).not.toHaveBeenCalled();
    });

    it("PUT /api/v1/catalog/variants/[id] rejects EXEMPT without statutory reference with HTTP 400", async () => {
      const req = makeNextRequest("http://localhost/api/v1/catalog/variants/var-1", "PUT", {
        taxTreatment: "EXEMPT",
        taxRateBp: 0,
        taxExemptionRef: "   ",
      });

      const res = await putVariantRoute(req, { params: Promise.resolve({ id: "var-1" }) });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("validation_error");
      expect(json.error.message).toMatch(/statutory reference/i);
      expect(mockTx.productVariant.update).not.toHaveBeenCalled();
    });

    it("PUT /api/v1/catalog/variants/[id] validates and passes valid GST treatment update through to persistence", async () => {
      mockDb.productVariant.findUnique.mockResolvedValue({
        id: "var-1",
        tenantId: TENANT_ID,
        sku: "ROUTE-UPDATE-SKU",
        taxRateBp: 0,
        taxTreatment: GstTaxTreatment.UNSPECIFIED,
        taxExemptionRef: null,
      });

      const req = makeNextRequest("http://localhost/api/v1/catalog/variants/var-1", "PUT", {
        taxRateBp: 1200,
        taxTreatment: "TAXABLE",
        taxExemptionRef: null,
      });

      const res = await putVariantRoute(req, { params: Promise.resolve({ id: "var-1" }) });
      expect(res.status).toBe(200);
      expect(mockTx.productVariant.update).toHaveBeenCalledWith({
        where: { id: "var-1", tenantId: TENANT_ID },
        data: expect.objectContaining({
          taxRateBp: 1200,
          taxTreatment: GstTaxTreatment.TAXABLE,
          taxExemptionRef: null,
        }),
      });
    });
  });
});


