import { describe, it, expect, vi, beforeEach } from "vitest";
import { GstTaxTreatment } from "@prisma/client";
import type { ErpRequest } from "@/server/erp/transport";

// Isolated mocks for the database layer so this suite runs completely offline without contacting PostgreSQL.
const mockDb = {
  productVariant: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  tenant: {
    findUnique: vi.fn(),
  },
};
vi.mock("@/server/db", () => ({ db: mockDb }));

const { ErpCatalogAdapter } = await import("@/server/erp/catalogAdapter");
const { FakeErpTransport } = await import("@/server/erp/fakeTransport");
const { ErpError } = await import("@/server/erp/errors");

type ErpCatalogAdapterInstance = InstanceType<typeof ErpCatalogAdapter>;
type FakeErpTransportInstance = InstanceType<typeof FakeErpTransport>;

describe("ErpCatalogAdapter offline unit tests", () => {
  let transport: FakeErpTransportInstance;
  let adapter: ErpCatalogAdapterInstance;

  const tenantId = "tenant-test-1";
  const variantId = "var-test-101";
  const correlationId = "corr-test-101";

  beforeEach(() => {
    vi.clearAllMocks();
    transport = new FakeErpTransport();
    adapter = new ErpCatalogAdapter(transport);

    // Provide test credentials in process.env for EnvErpCredentialProvider
    process.env["ERP_SITE_TEST_SITE_LOCAL_URL"] = "http://test-site.local";
    process.env["ERP_SITE_TEST_SITE_LOCAL_KEY"] = "test-key";
    process.env["ERP_SITE_TEST_SITE_LOCAL_SECRET"] = "test-secret";

    // Default tenant mock for resolveErpEnvironment
    mockDb.tenant.findUnique.mockResolvedValue({
      id: tenantId,
      erpnextSiteId: "test-site.local",
      erpnextProvisionStatus: "PROVISIONED",
      // GST-registered: non-TAXABLE items stay refused. (An unregistered business may sync NON_GST.)
      taxId: "29AAAAA0000A1Z5",
      erpnextClusterId: null,
      erpnextCompanyId: null,
      erpnextVersion: null,
    });
  });

  describe("undecided GST type safe rejection", () => {
    // Owner B3 (2026-10-16): every decided GST type syncs. Only an undecided one is refused.
    const nonTaxableTreatments: GstTaxTreatment[] = [GstTaxTreatment.UNSPECIFIED];

    it.each(nonTaxableTreatments)(
      "rejects %s treatment with validation_failed, marks sync FAILED, and sends zero requests",
      async (taxTreatment) => {
        mockDb.productVariant.findUnique.mockResolvedValue({
          id: variantId,
          tenantId,
          taxTreatment,
          taxRateBp: 0,
          isActive: true,
          priceMinor: 1000,
          product: {
            name: "Test Non-Taxable Shirt",
            category: "Apparel",
            imageUrl: null,
          },
        });

        await expect(
          adapter.syncVariant(tenantId, variantId, correlationId)
        ).rejects.toMatchObject({
          kind: "validation_failed",
          correlationId,
        });

        // Verifies database status was marked FAILED
        expect(mockDb.productVariant.update).toHaveBeenCalledWith({
          where: { id: variantId, tenantId },
          data: { erpSyncStatus: "FAILED" },
        });

        // Verifies zero ERP requests left the transport boundary
        expect(transport.sent).toHaveLength(0);
      }
    );
  });

  describe("decided non-taxable GST types sync with their ERPNext flags", () => {
    it.each([
      [GstTaxTreatment.EXEMPT, 1, 0],
      [GstTaxTreatment.NIL_RATED, 1, 0],
      [GstTaxTreatment.ZERO_RATED, 0, 0],
      [GstTaxTreatment.NON_GST, 0, 1],
    ] as const)("%s → is_nil_exempt=%i, is_non_gst=%i", async (taxTreatment, nilExempt, nonGst) => {
      mockDb.productVariant.findUnique.mockResolvedValue({
        id: variantId,
        tenantId,
        taxTreatment,
        taxRateBp: 0,
        size: null,
        colour: null,
        isActive: true,
        priceMinor: 1000,
        product: { name: "Plain Item", category: "Apparel", imageUrl: null },
      });
      transport.script(
        { kind: "respond", status: 200, body: { data: { name: variantId } } },
        { kind: "respond", status: 200, body: { data: { name: variantId } } },
      );

      await adapter.syncVariant(tenantId, variantId, correlationId);

      const put = transport.sent.find((r: ErpRequest) => r.method === "PUT");
      expect(put?.body).toMatchObject({ is_nil_exempt: nilExempt, is_non_gst: nonGst });
      expect(mockDb.productVariant.update).toHaveBeenCalledWith({
        where: { id: variantId, tenantId },
        data: { erpSyncStatus: "SYNCED" },
      });
    });
  });

  describe("tenant isolation", () => {
    it("ignores a variant not found under the requested tenantId and sends zero ERP requests", async () => {
      // Variant does not exist or belongs to another tenant (returns null)
      mockDb.productVariant.findUnique.mockResolvedValue(null);

      await adapter.syncVariant(tenantId, variantId, correlationId);

      // Verifies no update and no network call
      expect(mockDb.productVariant.update).not.toHaveBeenCalled();
      expect(transport.sent).toHaveLength(0);
    });
  });

  describe("lookup and update (PUT vs POST)", () => {
    it("issues PUT and does not issue POST when lookupItem finds an existing ERP item", async () => {
      mockDb.productVariant.findUnique.mockResolvedValue({
        id: variantId,
        tenantId,
        taxTreatment: GstTaxTreatment.TAXABLE,
        taxRateBp: 500,
        size: "M",
        colour: "Blue",
        isActive: true,
        priceMinor: 250000,
        product: {
          name: "Linen Shirt",
          category: "Apparel",
          imageUrl: "https://example.com/image.png",
        },
      });

      // 1st request (lookupItem GET): returns 200 with existing item name
      // 2nd request (PUT): returns 200 with updated item
      transport.script(
        {
          kind: "respond",
          status: 200,
          body: { data: { name: variantId } },
        },
        {
          kind: "respond",
          status: 200,
          body: { data: { name: variantId } },
        }
      );

      await adapter.syncVariant(tenantId, variantId, correlationId);

      expect(transport.sent).toHaveLength(2);

      // Request 1: GET lookup
      expect(transport.sent[0]?.method).toBe("GET");
      expect(transport.sent[0]?.path).toBe(`/api/resource/Item/${encodeURIComponent(variantId)}`);

      // Request 2: PUT update
      expect(transport.sent[1]?.method).toBe("PUT");
      expect(transport.sent[1]?.path).toBe(`/api/resource/Item/${encodeURIComponent(variantId)}`);

      // Ensure NO POST request was sent
      const postRequests = transport.sent.filter((req: ErpRequest) => req.method === "POST");
      expect(postRequests).toHaveLength(0);

      // Status marked SYNCED
      expect(mockDb.productVariant.update).toHaveBeenCalledWith({
        where: { id: variantId, tenantId },
        data: { erpSyncStatus: "SYNCED" },
      });
    });

    it("issues POST when lookupItem returns 404 (item does not exist yet)", async () => {
      mockDb.productVariant.findUnique.mockResolvedValue({
        id: variantId,
        tenantId,
        taxTreatment: GstTaxTreatment.TAXABLE,
        taxRateBp: 500,
        size: "L",
        colour: "White",
        isActive: true,
        priceMinor: 150000,
        product: {
          name: "Cotton Tee",
          category: "Apparel",
          imageUrl: null,
        },
      });

      // 1st request (lookupItem GET): returns 404 not found
      // 2nd request (Item Group GET): "Apparel" exists in ERPNext
      // 3rd request (POST create): returns 200
      transport.script(
        {
          kind: "respond",
          status: 404,
          body: { message: "Item not found" },
        },
        {
          kind: "respond",
          status: 200,
          body: { data: { name: "Apparel" } },
        },
        {
          kind: "respond",
          status: 200,
          body: { data: { name: variantId } },
        }
      );

      await adapter.syncVariant(tenantId, variantId, correlationId);

      expect(transport.sent).toHaveLength(3);
      expect(transport.sent[0]?.method).toBe("GET");
      expect(transport.sent[1]?.path).toBe(`/api/resource/Item Group/${encodeURIComponent("Apparel")}`);
      expect(transport.sent[2]?.method).toBe("POST");
      expect(transport.sent[2]?.path).toBe("/api/resource/Item");
      expect((transport.sent[2]?.body as { item_group?: string }).item_group).toBe("Apparel");

      expect(mockDb.productVariant.update).toHaveBeenCalledWith({
        where: { id: variantId, tenantId },
        data: { erpSyncStatus: "SYNCED" },
      });
    });
  });

  it("falls back to the stock Products group when ERPNext has no group for the category", async () => {
    mockDb.productVariant.findUnique.mockResolvedValue({
      id: variantId,
      tenantId,
      taxTreatment: GstTaxTreatment.TAXABLE,
      taxRateBp: 500,
      size: null,
      colour: null,
      isActive: true,
      priceMinor: 100000,
      product: { name: "Phone Case", category: "MOBILE", imageUrl: "/uploads/t/x.png" },
    });
    transport.script(
      { kind: "respond", status: 404, body: { message: "Item not found" } },
      { kind: "respond", status: 404, body: { message: "Item Group not found" } },
      { kind: "respond", status: 200, body: { data: { name: variantId } } }
    );

    await adapter.syncVariant(tenantId, variantId, correlationId);

    const body = transport.sent[2]?.body as { item_group?: string; image?: string | null };
    expect(body.item_group).toBe("Products");
    // A relative upload path is AMBURAX's, not something ERPNext can open.
    expect(body.image).toBeNull();
  });

  describe("retry after ambiguous create failure", () => {
    it("safely discovers and updates the item via PUT on retry if the previous attempt succeeded on the ERP side", async () => {
      // Scenario:
      // First attempt: client performed GET (404), then POST, but connection dropped / timed out.
      // However, the ERP actually persisted the item with item_code = variantId.
      // Second attempt (retry): lookupItem GET now finds the item and the adapter switches to PUT.

      mockDb.productVariant.findUnique.mockResolvedValue({
        id: variantId,
        tenantId,
        taxTreatment: GstTaxTreatment.TAXABLE,
        taxRateBp: 500,
        size: "M",
        colour: "Black",
        isActive: true,
        priceMinor: 200000,
        product: {
          name: "Retry Test Polo",
          category: "Apparel",
          imageUrl: null,
        },
      });

      // Attempt 1: GET (404) -> Item Group GET -> POST (connection drops / throws timeout)
      transport.script(
        {
          kind: "respond",
          status: 404,
          body: { message: "Not found" },
        },
        {
          kind: "respond",
          status: 200,
          body: { data: { name: "Apparel" } },
        },
        {
          kind: "timeout",
        }
      );

      await expect(
        adapter.syncVariant(tenantId, variantId, "corr-attempt-1")
      ).rejects.toBeInstanceOf(ErpError);

      expect(transport.sent).toHaveLength(3);
      expect(transport.sent[0]?.method).toBe("GET");
      expect(transport.sent[2]?.method).toBe("POST");
      expect(mockDb.productVariant.update).toHaveBeenCalledWith({
        where: { id: variantId, tenantId },
        data: { erpSyncStatus: "FAILED" },
      });

      // Reset transport request log to test replay attempt
      transport.sent.length = 0;

      // Attempt 2 (Retry replay):
      // Because the ERP had already created the item before the timeout,
      // lookupItem GET now returns 200 with the item name.
      transport.script(
        {
          kind: "respond",
          status: 200,
          body: { data: { name: variantId } },
        },
        {
          kind: "respond",
          status: 200,
          body: { data: { name: variantId } },
        }
      );

      await adapter.syncVariant(tenantId, variantId, "corr-attempt-2");

      expect(transport.sent).toHaveLength(2);
      expect(transport.sent[0]?.method).toBe("GET");
      // Key invariant: It did NOT send a duplicate POST; it safely issued PUT!
      expect(transport.sent[1]?.method).toBe("PUT");
      expect(transport.sent[1]?.path).toBe(`/api/resource/Item/${encodeURIComponent(variantId)}`);

      expect(mockDb.productVariant.update).toHaveBeenCalledWith({
        where: { id: variantId, tenantId },
        data: { erpSyncStatus: "SYNCED" },
      });
    });
  });
});
