import { describe, it, expect, beforeEach } from "vitest";
import { db, IDS, resetDatabase, seedTwoTenants } from "./db";
import { adjustStock, receiveStock } from "@/server/inventory/inventoryService";
import { createProduct } from "@/server/catalog/catalogService";
import { FakeErpTransport } from "@/server/erp/fakeTransport";
import { ErpSaleAdapter } from "@/server/erp/saleAdapter";
import { ErpCatalogAdapter } from "@/server/erp/catalogAdapter";
import { ErpStoreAdapter } from "@/server/erp/storeAdapter";
import { ErpInventoryAdapter } from "@/server/erp/inventoryAdapter";
import { ErpOutboxPublisher } from "@/server/erp/outboxPublisher";
import { dispatchOutboxOnce } from "@/server/events/outboxDispatcher";

// ── Shared helpers ────────────────────────────────────────────────────────────

async function provisionTenantForErp(tenantId: string, storeId: string) {
  await db.tenant.update({
    where: { id: tenantId },
    data: {
      erpnextProvisionStatus: "PROVISIONED",
      erpnextSiteId: "test-site.local",
    },
  });

  await db.store.update({
    where: { id: storeId },
    data: {
      erpnextProvisionStatus: "PROVISIONED",
      erpnextWarehouseId: "Stores - AR",
    },
  });
}

/**
 * Create a product+variant and drain the ProductVariantCreated outbox events
 * that createProduct emits so they do not interfere with subsequent
 * StockMovementCreated assertions.
 */
async function seedVariantAndDrainCatalogEvents(
  tenantId: string,
  userId: string,
  transport: FakeErpTransport,
  publisher: ErpOutboxPublisher,
  { sku, name }: { sku: string; name: string }
): Promise<string> {
  const uom =
    (await db.uom.findFirst({ where: { tenantId } })) ??
    (await db.uom.create({ data: { tenantId, code: "NOS", name: "Numbers" } }));

  const productRes = await createProduct({
    actor: { tenantId, userId, tenantRole: "OWNER" } as never,
    name,
    category: "Apparel",
    brand: null,
    baseUomId: uom.id,
    isActive: true,
    correlationId: `corr-create-${sku}`,
    firstVariant: { sku, barcode: null, priceMinor: 2500, mrpMinor: null, size: "M", colour: "Blue", isActive: true },
  });

  if (productRes.status !== "ok") {
    throw new Error(`createProduct failed: ${productRes.status}`);
  }

  const variantId = productRes.variantId!;

  // Drain catalog events with a blanket success response.
  transport.always({ kind: "respond", status: 200, body: { data: { name: "frappe-item-id" } } });
  await dispatchOutboxOnce({ publisher });
  // Reset the sent log so assertions only see stock movement calls.
  transport.sent.length = 0;

  return variantId;
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("ERPNext Inventory Sync (Outbox)", () => {
  let transport: FakeErpTransport;
  let publisher: ErpOutboxPublisher;

  beforeEach(async () => {
    await resetDatabase();
    await seedTwoTenants();

    transport = new FakeErpTransport();
    publisher = new ErpOutboxPublisher(
      new ErpSaleAdapter(transport),
      new ErpCatalogAdapter(transport),
      new ErpStoreAdapter(transport),
      new ErpInventoryAdapter(transport)
    );

    // Synthetic ERP credentials consumed by EnvErpCredentialProvider.
    process.env["ERP_SITE_TEST_SITE_LOCAL_URL"] = "http://test-site.local";
    process.env["ERP_SITE_TEST_SITE_LOCAL_KEY"] = "test-key";
    process.env["ERP_SITE_TEST_SITE_LOCAL_SECRET"] = "test-secret";
  });

  // ── Test 1: Material Receipt ──────────────────────────────────────────────

  it("positive receipt → ERPNext Stock Entry with Material Receipt", async () => {
    const tenantId = IDS.tenantA;
    const userId = IDS.ownerA;
    const storeId = IDS.storeA;

    await provisionTenantForErp(tenantId, storeId);

    const variantId = await seedVariantAndDrainCatalogEvents(
      tenantId, userId, transport, publisher,
      { sku: "TSH-M-BLU", name: "T-Shirt Blue M" }
    );

    // Script the three calls the adapter will make:
    //   1. GET  Stock Entry  — idempotency lookup  → not found
    //   2. POST Stock Entry  — create draft         → STE-00001
    //   3. PUT  Stock Entry  — submit               → STE-00001
    transport.script(
      { kind: "respond", status: 200, body: { data: [] } },
      { kind: "respond", status: 201, body: { data: { name: "STE-00001" } } },
      { kind: "respond", status: 200, body: { data: { name: "STE-00001" } } }
    );

    const res = await receiveStock({
      actor: { tenantId, userId, tenantRole: "OWNER" } as never,
      storeId,
      variantId,
      quantity: 50,
      reason: "Initial stock",
      requestKey: "req-rcv-1",
      correlationId: "corr-rcv-1",
    });

    expect(res.status).toBe("ok");

    const { published, failed } = await dispatchOutboxOnce({ publisher });
    expect(failed).toBe(0);
    expect(published).toBe(1);

    const posts = transport.sent.filter(
      (r) => r.method === "POST" && r.path.includes("Stock Entry")
    );
    expect(posts).toHaveLength(1);

    const body = posts[0]!.body as Record<string, unknown>;
    expect(body["purpose"]).toBe("Material Receipt");
    expect((body["items"] as Record<string, unknown>[])[0]!["item_code"]).toBe(variantId);
    expect((body["items"] as Record<string, unknown>[])[0]!["t_warehouse"]).toBe("Stores - AR");
    expect((body["items"] as Record<string, unknown>[])[0]!["qty"]).toBe(50);
    // remarks must embed the movement id for idempotency
    expect(typeof body["remarks"]).toBe("string");
    expect((body["remarks"] as string)).toContain("amburax-movement-id:");
  });

  // ── Test 2: Material Issue ────────────────────────────────────────────────

  it("negative adjustment → ERPNext Stock Entry with Material Issue", async () => {
    const tenantId = IDS.tenantA;
    const userId = IDS.ownerA;
    const storeId = IDS.storeA;

    await provisionTenantForErp(tenantId, storeId);

    const variantId = await seedVariantAndDrainCatalogEvents(
      tenantId, userId, transport, publisher,
      { sku: "TSH-L-BLK", name: "T-Shirt Black L" }
    );

    transport.script(
      { kind: "respond", status: 200, body: { data: [] } },
      { kind: "respond", status: 201, body: { data: { name: "STE-00002" } } },
      { kind: "respond", status: 200, body: { data: { name: "STE-00002" } } }
    );

    const res = await adjustStock({
      actor: { tenantId, userId, tenantRole: "OWNER" } as never,
      storeId,
      variantId,
      quantityDelta: -10,
      reason: "Damage write-off",
      requestKey: "req-adj-1",
      correlationId: "corr-adj-1",
    });

    expect(res.status).toBe("ok");

    const { published, failed } = await dispatchOutboxOnce({ publisher });
    expect(failed).toBe(0);
    expect(published).toBe(1);

    const posts = transport.sent.filter(
      (r) => r.method === "POST" && r.path.includes("Stock Entry")
    );
    expect(posts).toHaveLength(1);

    const body = posts[0]!.body as Record<string, unknown>;
    expect(body["purpose"]).toBe("Material Issue");
    expect((body["items"] as Record<string, unknown>[])[0]!["item_code"]).toBe(variantId);
    expect((body["items"] as Record<string, unknown>[])[0]!["s_warehouse"]).toBe("Stores - AR");
    expect((body["items"] as Record<string, unknown>[])[0]!["t_warehouse"]).toBeUndefined();
    expect((body["items"] as Record<string, unknown>[])[0]!["qty"]).toBe(10);
  });

  // ── Test 3: Idempotency ───────────────────────────────────────────────────

  it("duplicate event delivery → idempotency guard prevents double stock entry", async () => {
    const tenantId = IDS.tenantA;
    const userId = IDS.ownerA;
    const storeId = IDS.storeA;

    await provisionTenantForErp(tenantId, storeId);

    const variantId = await seedVariantAndDrainCatalogEvents(
      tenantId, userId, transport, publisher,
      { sku: "TSH-S-RED", name: "T-Shirt Red S" }
    );

    // First delivery: GET(not found) → POST → PUT
    transport.script(
      { kind: "respond", status: 200, body: { data: [] } },
      { kind: "respond", status: 201, body: { data: { name: "STE-00003" } } },
      { kind: "respond", status: 200, body: { data: { name: "STE-00003" } } }
    );

    const res = await receiveStock({
      actor: { tenantId, userId, tenantRole: "OWNER" } as never,
      storeId,
      variantId,
      quantity: 20,
      reason: "Restock",
      requestKey: "req-rcv-idem",
      correlationId: "corr-rcv-idem",
    });
    expect(res.status).toBe("ok");

    const firstRun = await dispatchOutboxOnce({ publisher });
    expect(firstRun.published).toBe(1);

    // Re-insert the SAME outbox event manually to simulate a duplicate delivery.
    const movement = await db.stockMovement.findFirst({ where: { tenantId, idempotencyKey: "RECEIPT:req-rcv-idem" } });
    expect(movement).not.toBeNull();

    await db.outboxEvent.create({
      data: {
        tenantId,
        storeId,
        eventType: "StockMovementCreated",
        entityId: movement!.id,
        correlationId: "corr-rcv-idem-dup",
        causationId: "RECEIPT:req-rcv-idem",
        actorUserId: userId,
        payload: { movementId: movement!.id },
        idempotencyKey: `${tenantId}:StockMovementCreated:${movement!.id}:dup`,
        nextAttemptAt: new Date(0), // due immediately
      },
    });

    // Reset sent log before duplicate run.
    transport.sent.length = 0;

    // Duplicate delivery: GET(found → return early) — NO POST.
    transport.script(
      { kind: "respond", status: 200, body: { data: [{ name: "STE-00003", remarks: `amburax-movement-id:${movement!.id}` }] } }
    );

    const secondRun = await dispatchOutboxOnce({ publisher });
    expect(secondRun.published).toBe(1); // event is processed without error

    // Only ONE request was made (the GET), no POST.
    const requests = transport.sent;
    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe("GET");
  });

  // ── Test 4: Tenant isolation ──────────────────────────────────────────────

  it("tenant B movement id cannot be synced via tenant A credentials", async () => {
    const tenantA = IDS.tenantA;
    const tenantB = IDS.tenantB;
    const storeA = IDS.storeA;
    const storeB = IDS.storeB;
    const userId = IDS.ownerA;

    // Only provision tenant A; tenant B has no ERP config.
    await provisionTenantForErp(tenantA, storeA);

    // Seed a variant in tenant B via direct DB insert — no outbox for this.
    const uomB =
      (await db.uom.findFirst({ where: { tenantId: tenantB } })) ??
      (await db.uom.create({ data: { tenantId: tenantB, code: "NOS", name: "Numbers" } }));

    const productB = await db.product.create({
      data: {
        tenantId: tenantB,
        name: "Tenant B Product",
        category: "Test",
        baseUomId: uomB.id,
        isActive: true,
      },
    });

    const variantB = await db.productVariant.create({
      data: {
        tenantId: tenantB,
        productId: productB.id,
        sku: "B-ITEM-001",
        priceMinor: 100,
      },
    });

    // Create a movement for tenant B / store B / variant B.
    const movementB = await db.stockMovement.create({
      data: {
        tenantId: tenantB,
        storeId: storeB,
        variantId: variantB.id,
        type: "RECEIPT",
        quantityDelta: 5,
        balanceAfter: 5,
        idempotencyKey: "RECEIPT:b-key-001",
        actorUserId: IDS.ownerB,
        reason: "Test",
      },
    });

    // Attempt to sync tenant B's movement with tenant A's tenantId.
    const adapter = new ErpInventoryAdapter(transport);
    await expect(
      adapter.syncMovement(tenantA, movementB.id, "corr-isolation")
    ).rejects.toThrow(/not found/);

    // No HTTP calls should have been made.
    expect(transport.sent).toHaveLength(0);
  });
});
