import { describe, it, expect, beforeEach } from "vitest";
import { db, IDS, COMMERCE_IDS, resetDatabase, seedTwoTenants, seedCommerce } from "./db";
import { createCustomer, updateCustomer } from "@/server/sales/customers";
import { createSale } from "@/server/sales/saleService";
import { FakeErpTransport } from "@/server/erp/fakeTransport";
import { ErpSaleAdapter } from "@/server/erp/saleAdapter";
import { ErpCatalogAdapter } from "@/server/erp/catalogAdapter";
import { ErpStoreAdapter } from "@/server/erp/storeAdapter";
import { ErpInventoryAdapter } from "@/server/erp/inventoryAdapter";
import { ErpCustomerAdapter } from "@/server/erp/customerAdapter";
import { ErpOutboxPublisher } from "@/server/erp/outboxPublisher";
import { dispatchOutboxOnce } from "@/server/events/outboxDispatcher";
import { randomUUID } from "node:crypto";

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

describe("ERPNext Customer Sync (Outbox)", () => {
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
      new ErpInventoryAdapter(transport),
      new ErpCustomerAdapter(transport)
    );

    process.env["ERP_SITE_TEST_SITE_LOCAL_URL"] = "http://test-site.local";
    process.env["ERP_SITE_TEST_SITE_LOCAL_KEY"] = "test-key";
    process.env["ERP_SITE_TEST_SITE_LOCAL_SECRET"] = "test-secret";
  });

  // ── Test 1: Customer Creation ─────────────────────────────────────────────

  it("creates an AMBURAX customer → outbox event → ERPNext Customer created", async () => {
    const tenantId = IDS.tenantA;
    const storeId = IDS.storeA;
    await provisionTenantForErp(tenantId, storeId);

    // Fake transport sequence for CustomerCreated:
    // 1. GET lookup (returns empty data = not found)
    // 2. POST create (returns created customer)
    transport.script(
      { kind: "respond", status: 200, body: { data: [] } },
      { kind: "respond", status: 200, body: { data: { name: "Ananya Sharma" } } }
    );

    const res = await createCustomer({
      tenantId,
      name: "Ananya Sharma",
      phone: "9876543210",
      actorUserId: IDS.ownerA,
      correlationId: "corr-cust-create-1",
    });

    expect(res.status).toBe("ok");
    if (res.status !== "ok") throw new Error("createCustomer failed");
    expect(res.existing).toBe(false);
    const customer = res.customer;

    const { published, failed } = await dispatchOutboxOnce({ publisher });
    expect(failed).toBe(0);
    expect(published).toBe(1);

    const posts = transport.sent.filter(
      (r) => r.method === "POST" && r.path.includes("Customer")
    );
    expect(posts).toHaveLength(1);

    const body = posts[0]!.body as Record<string, unknown>;
    expect(body["customer_name"]).toBe("Ananya Sharma");
    expect(body["customer_pos_id"]).toBe(customer.id);
    expect(body["mobile_no"]).toBe("9876543210");
  });

  // ── Test 2: Customer Update ───────────────────────────────────────────────

  it("updates an AMBURAX customer → outbox event → ERPNext Customer updated", async () => {
    const tenantId = IDS.tenantA;
    const storeId = IDS.storeA;
    await provisionTenantForErp(tenantId, storeId);

    // Pre-create customer in local DB directly (or drain create outbox)
    const customer = await db.customer.create({
      data: {
        tenantId,
        name: "Rahul Verma",
        phone: "9123456780",
      },
    });

    // Fake transport sequence for CustomerUpdated:
    // 1. GET lookup (returns existing customer name "Rahul Verma")
    // 2. PUT update (returns updated record)
    transport.script(
      {
        kind: "respond",
        status: 200,
        body: {
          data: [
            {
              name: "Rahul Verma",
              customer_name: "Rahul Verma",
              mobile_no: "9123456780",
            },
          ],
        },
      },
      { kind: "respond", status: 200, body: { data: { name: "Rahul Verma" } } }
    );

    const res = await updateCustomer({
      tenantId,
      id: customer.id,
      name: "Rahul Verma Senior",
      phone: "9123456789",
      email: "rahul@example.com",
      actorUserId: IDS.ownerA,
      correlationId: "corr-cust-upd-1",
    });

    expect(res.status).toBe("ok");

    const { published, failed } = await dispatchOutboxOnce({ publisher });
    expect(failed).toBe(0);
    expect(published).toBe(1);

    const puts = transport.sent.filter(
      (r) => r.method === "PUT" && r.path.includes("Customer")
    );
    expect(puts).toHaveLength(1);

    const body = puts[0]!.body as Record<string, unknown>;
    expect(body["customer_name"]).toBe("Rahul Verma Senior");
    expect(body["mobile_no"]).toBe("9123456789");
    expect(body["email_id"]).toBe("rahul@example.com");
  });

  // ── Test 3: Idempotency ───────────────────────────────────────────────────

  it("duplicate CustomerCreated delivery does not create duplicate ERPNext Customer", async () => {
    const tenantId = IDS.tenantA;
    const storeId = IDS.storeA;
    await provisionTenantForErp(tenantId, storeId);

    // Initial creation with script
    transport.script(
      { kind: "respond", status: 200, body: { data: [] } },
      { kind: "respond", status: 200, body: { data: { name: "Pooja Patel" } } }
    );

    const res = await createCustomer({
      tenantId,
      name: "Pooja Patel",
      phone: "9988776655",
      actorUserId: IDS.ownerA,
      correlationId: "corr-cust-idem",
    });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") throw new Error("createCustomer failed");

    const firstRun = await dispatchOutboxOnce({ publisher });
    expect(firstRun.published).toBe(1);

    // Manually simulate a duplicated delivery by enqueuing a duplicate outbox event
    await db.outboxEvent.create({
      data: {
        tenantId,
        eventType: "CustomerCreated",
        entityId: res.customer.id,
        correlationId: "corr-cust-idem-dup",
        causationId: "corr-cust-idem",
        actorUserId: IDS.ownerA,
        payload: { customerId: res.customer.id },
        idempotencyKey: `${tenantId}:CustomerCreated:${res.customer.id}:dup`,
        nextAttemptAt: new Date(0),
      },
    });

    // Reset sent log
    transport.sent.length = 0;

    // Second run: lookup finds customer, no POST is issued
    transport.script({
      kind: "respond",
      status: 200,
      body: {
        data: [
          {
            name: "Pooja Patel",
            customer_name: "Pooja Patel",
            mobile_no: "9988776655",
          },
        ],
      },
    });

    const secondRun = await dispatchOutboxOnce({ publisher });
    expect(secondRun.published).toBe(1);

    // Only 1 GET request was made, 0 POSTs
    const posts = transport.sent.filter((r) => r.method === "POST");
    expect(posts).toHaveLength(0);
  });

  // ── Test 4: Tenant Isolation ──────────────────────────────────────────────

  it("tenant B customer cannot be synced using tenant A credentials", async () => {
    const tenantA = IDS.tenantA;
    const tenantB = IDS.tenantB;
    const storeA = IDS.storeA;

    await provisionTenantForErp(tenantA, storeA);

    // Create customer directly under tenant B
    const customerB = await db.customer.create({
      data: {
        tenantId: tenantB,
        name: "Tenant B Buyer",
        phone: "9000000000",
      },
    });

    const adapter = new ErpCustomerAdapter(transport);
    await expect(
      adapter.syncCustomer(tenantA, customerB.id, "corr-isolation")
    ).rejects.toThrow(/not found/);

    expect(transport.sent).toHaveLength(0);
  });

  // ── Test 5: POS Customer Sale Regression ──────────────────────────────────

  it("POS sale with assigned customer links the correct ERPNext Customer to Sales Invoice", async () => {
    await seedCommerce();
    const tenantId = IDS.tenantA;
    const storeId = IDS.storeA;
    const userId = IDS.ownerA;

    await provisionTenantForErp(tenantId, storeId);

    // Create and seed customer
    const customer = await db.customer.create({
      data: {
        tenantId,
        name: "Vikram Malhotra",
        phone: "9811122233",
      },
    });

    // Prepare fake responses for sale sync:
    // 1. lookup invoice (not found)
    // 2. lookup customer by customer_pos_id (returns "Vikram Malhotra")
    // 3. create Sales Invoice
    // 4. submit Sales Invoice
    transport.script(
      { kind: "respond", status: 200, body: { data: [] } }, // Invoice lookup
      {
        kind: "respond",
        status: 200,
        body: { data: [{ name: "Vikram Malhotra" }] }, // Customer lookup
      },
      { kind: "respond", status: 200, body: { data: { name: "SINV-CUST-001" } } } // Create invoice
    );

    const saleResult = await createSale({
      tenantId,
      storeId,
      customerId: customer.id,
      cashierUserId: userId,
      correlationId: randomUUID(),
      idempotencyKey: randomUUID(),
      lines: [
        { variantId: COMMERCE_IDS.variantA1, quantity: 1 },
      ],
      payments: [
        { method: "CASH", amountMinor: 100_000 },
      ],
    });

    expect(saleResult.status).toBe("ok");
    if (saleResult.status !== "ok") throw new Error("createSale failed");

    const saleAdapter = new ErpSaleAdapter(transport);
    await saleAdapter.syncSale(tenantId, saleResult.sale.id, "corr-sale-cust");

    const invoicePosts = transport.sent.filter(
      (r) => r.method === "POST" && r.path.includes("Sales Invoice")
    );
    expect(invoicePosts).toHaveLength(1);

    const invoiceBody = invoicePosts[0]!.body as Record<string, unknown>;
    expect(invoiceBody["customer"]).toBe("Vikram Malhotra");
  });
});
