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
  auditLog: {
    findFirst: vi.fn(),
  },
};
vi.mock("@/server/db", () => ({ db: mockDb }));

const { ErpCatalogAdapter } = await import("@/server/erp/catalogAdapter");
const { FakeErpTransport } = await import("@/server/erp/fakeTransport");
const { ErpError } = await import("@/server/erp/errors");

type ErpCatalogAdapterInstance = InstanceType<typeof ErpCatalogAdapter>;
type FakeErpTransportInstance = InstanceType<typeof FakeErpTransport>;

describe("catalogTaxSync", () => {
  let transport: FakeErpTransportInstance;
  let adapter: ErpCatalogAdapterInstance;

  const tenantId = "tenant-tax-sync-1";
  const variantId = "variant-101";
  const correlationId = "corr-tax-sync-101";

  beforeEach(() => {
    vi.clearAllMocks();
    transport = new FakeErpTransport();
    adapter = new ErpCatalogAdapter(transport);

    // Provide test credentials in process.env for EnvErpCredentialProvider
    process.env["ERP_SITE_TEST_SITE_LOCAL_URL"] = "http://test-site.local";
    process.env["ERP_SITE_TEST_SITE_LOCAL_KEY"] = "test-key";
    process.env["ERP_SITE_TEST_SITE_LOCAL_SECRET"] = "test-secret";
  });

  it("syncVariant_allows_unspecified_tax_treatment_for_non_gst_tenant", async () => {
    // Non-GST shop: taxId is null/empty and no GST registration audit log
    mockDb.tenant.findUnique.mockImplementation(async (args: any) => {
      if (args.select?.taxId) {
        return { taxId: null };
      }
      return {
        id: tenantId,
        erpnextSiteId: "test-site.local",
        erpnextProvisionStatus: "PROVISIONED",
        taxId: null,
        erpnextClusterId: null,
        erpnextCompanyId: null,
        erpnextVersion: null,
      };
    });

    mockDb.auditLog.findFirst.mockResolvedValue(null);

    mockDb.productVariant.findUnique.mockResolvedValue({
      id: variantId,
      tenantId,
      taxTreatment: GstTaxTreatment.UNSPECIFIED,
      taxRateBp: 0,
      size: "M",
      colour: "Navy",
      isActive: true,
      priceMinor: 25000,
      product: {
        name: "Linen Shirt",
        category: "Apparel",
        imageUrl: null,
        hsnCode: "6205",
      },
    });

    transport.script(
      { kind: "respond", status: 200, body: { data: { name: variantId } } },
      { kind: "respond", status: 200, body: { data: { name: variantId } } }
    );

    await adapter.syncVariant(tenantId, variantId, correlationId);

    const put = transport.sent.find((r: ErpRequest) => r.method === "PUT");
    expect(put).toBeDefined();
    // Synced with non-GST flags: is_non_gst = 1, is_nil_exempt = 0, standard_rate = 250
    expect(put?.body).toMatchObject({
      item_code: variantId,
      standard_rate: 250,
      is_non_gst: 1,
      is_nil_exempt: 0,
    });
    // HSN code should NOT be sent when item is treated as non-GST
    expect((put?.body as any)?.gst_hsn_code).toBeUndefined();

    expect(mockDb.productVariant.update).toHaveBeenCalledWith({
      where: { id: variantId, tenantId },
      data: { erpSyncStatus: "SYNCED" },
    });
  });

  it("syncVariant_refuses_unspecified_tax_treatment_for_gst_registered_tenant", async () => {
    // GST-registered shop: taxId is set
    mockDb.tenant.findUnique.mockImplementation(async (args: any) => {
      if (args.select?.taxId) {
        return { taxId: "27ABCDE1234F1Z5" };
      }
      return {
        id: tenantId,
        erpnextSiteId: "test-site.local",
        erpnextProvisionStatus: "PROVISIONED",
        taxId: "27ABCDE1234F1Z5",
        erpnextClusterId: null,
        erpnextCompanyId: null,
        erpnextVersion: null,
      };
    });

    mockDb.auditLog.findFirst.mockResolvedValue(null);

    mockDb.productVariant.findUnique.mockResolvedValue({
      id: variantId,
      tenantId,
      taxTreatment: GstTaxTreatment.UNSPECIFIED,
      taxRateBp: 0,
      size: "L",
      colour: "White",
      isActive: true,
      priceMinor: 15000,
      product: {
        name: "Formal Shirt",
        category: "Apparel",
        imageUrl: null,
        hsnCode: "6205",
      },
    });

    await expect(
      adapter.syncVariant(tenantId, variantId, correlationId)
    ).rejects.toMatchObject({
      kind: "validation_failed",
      correlationId,
    });

    expect(mockDb.productVariant.update).toHaveBeenCalledWith({
      where: { id: variantId, tenantId },
      data: { erpSyncStatus: "FAILED" },
    });

    expect(transport.sent).toHaveLength(0);
  });

  it("syncVariant_syncs_decided_treatments_for_both_gst_and_non_gst_tenants", async () => {
    const cases = [
      {
        taxId: "27ABCDE1234F1Z5",
        treatment: GstTaxTreatment.TAXABLE,
        expectedNonGst: 0,
        expectedNilExempt: 0,
        hsn: "6205",
        expectHsnSent: true,
      },
      {
        taxId: "27ABCDE1234F1Z5",
        treatment: GstTaxTreatment.EXEMPT,
        expectedNonGst: 0,
        expectedNilExempt: 1,
        hsn: "6205",
        expectHsnSent: true,
      },
      {
        taxId: null,
        treatment: GstTaxTreatment.NON_GST,
        expectedNonGst: 1,
        expectedNilExempt: 0,
        hsn: "6205",
        expectHsnSent: false,
      },
    ];

    for (const [idx, c] of cases.entries()) {
      mockDb.tenant.findUnique.mockImplementation(async (args: any) => {
        if (args.select?.taxId) {
          return { taxId: c.taxId };
        }
        return {
          id: tenantId,
          erpnextSiteId: "test-site.local",
          erpnextProvisionStatus: "PROVISIONED",
          taxId: c.taxId,
          erpnextClusterId: null,
          erpnextCompanyId: null,
          erpnextVersion: null,
        };
      });

      const currentVariantId = `${variantId}-${idx}`;
      mockDb.productVariant.findUnique.mockResolvedValue({
        id: currentVariantId,
        tenantId,
        taxTreatment: c.treatment,
        taxRateBp: c.treatment === GstTaxTreatment.TAXABLE ? 1200 : 0,
        size: "M",
        colour: "Blue",
        isActive: true,
        priceMinor: 20000,
        product: {
          name: "Decided Shirt",
          category: "Apparel",
          imageUrl: null,
          hsnCode: c.hsn,
        },
      });

      transport.script(
        { kind: "respond", status: 200, body: { data: { name: currentVariantId } } },
        { kind: "respond", status: 200, body: { data: { name: currentVariantId } } }
      );

      await adapter.syncVariant(tenantId, currentVariantId, correlationId);

      const put = transport.sent[transport.sent.length - 1];
      expect(put?.body).toMatchObject({
        item_code: currentVariantId,
        is_non_gst: c.expectedNonGst,
        is_nil_exempt: c.expectedNilExempt,
      });

      if (c.expectHsnSent) {
        expect((put?.body as any)?.gst_hsn_code).toBe(c.hsn);
      } else {
        expect((put?.body as any)?.gst_hsn_code).toBeUndefined();
      }

      expect(mockDb.productVariant.update).toHaveBeenCalledWith({
        where: { id: currentVariantId, tenantId },
        data: { erpSyncStatus: "SYNCED" },
      });
    }
  });

  it("syncVariant_refuses_unspecified_after_gst_was_turned_on", async () => {
    // Tenant currently has no taxId (e.g. cleared/deregistered or historical), but has registered GST in audit log
    mockDb.tenant.findUnique.mockImplementation(async (args: any) => {
      if (args.select?.taxId) {
        return { taxId: null };
      }
      return {
        id: tenantId,
        erpnextSiteId: "test-site.local",
        erpnextProvisionStatus: "PROVISIONED",
        taxId: null,
        erpnextClusterId: null,
        erpnextCompanyId: null,
        erpnextVersion: null,
      };
    });

    mockDb.auditLog.findFirst.mockResolvedValue({
      id: "audit-gst-registered-1",
      action: "tenant.gst_registered",
    });

    mockDb.productVariant.findUnique.mockResolvedValue({
      id: variantId,
      tenantId,
      taxTreatment: GstTaxTreatment.UNSPECIFIED,
      taxRateBp: 0,
      size: "XL",
      colour: "Black",
      isActive: true,
      priceMinor: 30000,
      product: {
        name: "Historical T-Shirt",
        category: "Apparel",
        imageUrl: null,
        hsnCode: "6205",
      },
    });

    await expect(
      adapter.syncVariant(tenantId, variantId, correlationId)
    ).rejects.toMatchObject({
      kind: "validation_failed",
      correlationId,
    });

    expect(mockDb.productVariant.update).toHaveBeenCalledWith({
      where: { id: variantId, tenantId },
      data: { erpSyncStatus: "FAILED" },
    });

    expect(transport.sent).toHaveLength(0);
  });
});
