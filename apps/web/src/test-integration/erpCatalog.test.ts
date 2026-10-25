import { describe, it, expect, beforeEach } from "vitest";
import { db, IDS, resetDatabase, seedTwoTenants } from "./db";
import { createProduct, createVariant } from "@/server/catalog/catalogService";
import { FakeErpTransport } from "@/server/erp/fakeTransport";
import { ErpSaleAdapter } from "@/server/erp/saleAdapter";
import { ErpCatalogAdapter } from "@/server/erp/catalogAdapter";
import { ErpOutboxPublisher } from "@/server/erp/outboxPublisher";
import { dispatchOutboxOnce } from "@/server/events/outboxDispatcher";

describe("ERPNext Catalog Sync (Outbox)", () => {
  let transport: FakeErpTransport;
  let publisher: ErpOutboxPublisher;

  beforeEach(async () => {
    await resetDatabase();
    await seedTwoTenants();
    transport = new FakeErpTransport();
    publisher = new ErpOutboxPublisher(
      new ErpSaleAdapter(transport),
      new ErpCatalogAdapter(transport)
    );

    // Provide credentials environment vars just for this test
    process.env["ERP_SITE_TEST_SITE_LOCAL_URL"] = "http://test-site.local";
    process.env["ERP_SITE_TEST_SITE_LOCAL_KEY"] = "test-key";
    process.env["ERP_SITE_TEST_SITE_LOCAL_SECRET"] = "test-secret";
  });

  it("does not contact ERPNext for an unresolved zero-rate variant", async () => {
    const tenantId = IDS.tenantA;
    await db.tenant.update({
      where: { id: tenantId },
      data: { erpnextProvisionStatus: "PROVISIONED", erpnextCompanyId: "Amburax Retail", erpnextSiteId: "test-site.local" },
    });
    const uom = await db.uom.findFirst({ where: { tenantId } });
    const created = await createProduct({
      actor: { tenantId, userId: IDS.ownerA, tenantRole: "OWNER" },
      name: "Unresolved item",
      category: "Products",
      brand: null,
      baseUomId: uom?.id ?? "",
      isActive: true,
      correlationId: "unresolved-tax",
      firstVariant: {
        sku: "UNRESOLVED-TAX",
        barcode: null,
        size: null,
        colour: null,
        priceMinor: 1000,
        mrpMinor: null,
        taxRateBp: 0,
        taxTreatment: "NON_GST",
        isActive: true,
      },
    });
    if (created.status !== "ok") throw new Error("Failed to seed unresolved item");
    // The catalogue no longer saves an UNSPECIFIED treatment, but rows from before that rule
    // still carry one. Recreate such a legacy row directly.
    await db.productVariant.update({ where: { id: created.variantId, tenantId }, data: { taxTreatment: "UNSPECIFIED" } });

    await expect(new ErpCatalogAdapter(transport).syncVariant(tenantId, created.variantId, "unresolved-tax"))
      .rejects.toMatchObject({ kind: "validation_failed" });
    expect(transport.sent).toHaveLength(0);
    const variant = await db.productVariant.findUnique({ where: { id: created.variantId, tenantId } });
    expect(variant?.erpSyncStatus).toBe("FAILED");
  });

  it("syncs variant creation to ERPNext item", async () => {
    const tenantId = IDS.tenantA;
    const userId = IDS.ownerA;

    await db.tenant.update({
      where: { id: tenantId },
      data: {
        erpnextProvisionStatus: "PROVISIONED", erpnextCompanyId: "Amburax Retail",
        erpnextSiteId: "test-site.local",
        // A taxable item can only be saved by a GST-registered business.
        taxId: "27AAPFU0939F1ZV",
      },
    });

    const uom = await db.uom.findFirst({ where: { tenantId } });
    const productRes = await createProduct({
      actor: { tenantId, userId, tenantRole: "OWNER" },
      name: "T-Shirt",
      category: "Apparel",
      brand: null,
      baseUomId: uom?.id ?? "", 
      isActive: true,
      correlationId: "test-corr-1",
      firstVariant: {
        sku: "TSHIRT-BLK-M",
        barcode: null,
        size: "M",
        colour: "Black",
        priceMinor: 1500,
        mrpMinor: null,
        taxRateBp: 500,
        taxTreatment: "TAXABLE",
        taxExemptionRef: null,
        isActive: true,
      }
    });

    if (productRes.status !== "ok") throw new Error("Failed to create product");

    transport.script(
      { kind: "respond", status: 200, body: { data: {} } }, // Initial lookup
      { kind: "respond", status: 200, body: { data: { name: "Apparel" } } }, // Item Group exists
      { kind: "respond", status: 200, body: { data: { name: "test-variant-id" } } } // Create
    );

    const variantId = productRes.variantId;

    let pending = await db.outboxEvent.findMany({ where: { tenantId } });
    expect(pending.length).toBe(1);
    expect(pending[0]?.eventType).toBe("ProductVariantCreated");
    expect(pending[0]?.entityId).toBe(variantId);

    // Dispatch outbox
    await dispatchOutboxOnce({
      batchSize: 10,
      publisher,
    });

    // Verify it succeeded
    pending = await db.outboxEvent.findMany({ where: { tenantId, publishedAt: null } });
    expect(pending.length).toBe(0);

    const published = await db.outboxEvent.findMany({ where: { tenantId, publishedAt: { not: null } } });
    expect(published.length).toBe(1);

    const updatedVariant = await db.productVariant.findUnique({
      where: { id: variantId, tenantId },
    });
    expect(updatedVariant?.erpSyncStatus).toBe("SYNCED");

    // Verify transport saw the correct requests
    const requests = transport.sent;
    expect(requests.length).toBe(3);

    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.path).toBe(`/api/resource/Item/${encodeURIComponent(variantId)}`);

    expect(requests[1]?.path).toBe(`/api/resource/Item Group/${encodeURIComponent("Apparel")}`);

    expect(requests[2]?.method).toBe("POST");
    expect(requests[2]?.path).toBe("/api/resource/Item");

    const body = requests[2]?.body as Record<string, any>;
    expect(body.item_code).toBe(variantId);
    expect(body.item_name).toBe("T-Shirt - M - Black");
    expect(body.item_group).toBe("Apparel");
    expect(body.stock_uom).toBe("Nos");
    expect(body.standard_rate).toBe(15);
  });
});
