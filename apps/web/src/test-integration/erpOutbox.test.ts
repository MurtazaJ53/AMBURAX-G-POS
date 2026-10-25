import { describe, it, expect, beforeEach } from "vitest";
import { db, IDS, COMMERCE_IDS, resetDatabase, seedTwoTenants, seedCommerce } from "./db";
import { createSale } from "@/server/sales/saleService";
import { FakeErpTransport } from "@/server/erp/fakeTransport";
import { ErpSaleAdapter } from "@/server/erp/saleAdapter";
import { ErpOutboxPublisher } from "@/server/erp/outboxPublisher";
import { dispatchOutboxOnce } from "@/server/events/outboxDispatcher";
import { randomUUID } from "crypto";

describe("ERPNext Vertical Slice (Outbox)", () => {
  let transport: FakeErpTransport;
  let publisher: ErpOutboxPublisher;

  beforeEach(async () => {
    await resetDatabase();
    await seedTwoTenants();
    await seedCommerce();
    transport = new FakeErpTransport().warehouseCompany("Amburax Retail");
    publisher = new ErpOutboxPublisher(new ErpSaleAdapter(transport));
  });

  it("completes a sale, creates outbox event, and syncs to ERPNext", async () => {
    const tenantId = IDS.tenantA;
    const storeId = IDS.storeA;
    const userId = IDS.ownerA;

    // 1. Provision the tenant for ERP
    await db.tenant.update({
      where: { id: tenantId },
      data: {
        erpnextProvisionStatus: "PROVISIONED", erpnextCompanyId: "Amburax Retail",
        erpnextSiteId: "test-site.local",
      },
    });

    // Provide credentials environment vars just for this test
    process.env["ERP_SITE_TEST_SITE_LOCAL_URL"] = "http://test-site.local";
    process.env["ERP_SITE_TEST_SITE_LOCAL_KEY"] = "test-key";
    process.env["ERP_SITE_TEST_SITE_LOCAL_SECRET"] = "test-secret";

    // 2. Prepare fake transport responses
    transport.script(
      { kind: "respond", status: 200, body: { data: [] } }, // 1. Initial lookup
      { kind: "respond", status: 200, body: { data: { name: "SINV-00001" } } } // 2. Create
    );

    // 3. Make a sale
    await db.store.update({
      where: { id: storeId },
      data: { erpnextWarehouseId: "Test Warehouse" },
    });

    const saleResult = await createSale({
      tenantId,
      storeId,
      cashierUserId: userId,
      correlationId: randomUUID(),
      idempotencyKey: randomUUID(),
      lines: [
        { variantId: COMMERCE_IDS.variantA1, quantity: 2 },
      ],
      payment: { method: "CASH", amountMinor: 200_000 },
    });

    if (saleResult.status !== "ok") {
      throw new Error("Sale creation failed: " + saleResult.status);
    }
    const saleId = saleResult.sale.id;

    // Verify outbox event created
    const outboxEvents = await db.outboxEvent.findMany({
      where: { tenantId, entityId: saleId },
    });
    expect(outboxEvents).toHaveLength(1);
    expect(outboxEvents[0]?.eventType).toBe("SaleCompleted");
    expect(outboxEvents[0]?.publishedAt).toBeNull();

    // 4. Dispatch the outbox
    const dispatchResult = await dispatchOutboxOnce({
      tenantId,
      publisher,
    });
    
    // It should have claimed and published 1 event
    expect(dispatchResult.claimed).toBeGreaterThanOrEqual(1);
    
    // Look for our specific event
    const publishedEvent = await db.outboxEvent.findUnique({
      where: { id: outboxEvents[0]!.id },
    });
    expect(publishedEvent?.publishedAt).not.toBeNull();
    expect(publishedEvent?.lastError).toBeNull();

    // 5. Verify ERP transport received the correct payload: lookup, create as draft, submit.
    // The invoice is created as a draft so its currency can be checked before it is submitted.
    expect(transport.sent).toHaveLength(3);

    // First call is GET (lookup)
    expect(transport.sent[0]!.method).toBe("GET");

    // Second call is POST (create, as a draft)
    const call = transport.sent[1]!;
    expect(call.method).toBe("POST");
    expect(call.path).toBe("/api/resource/Sales Invoice");
    expect((call.body as { docstatus: number }).docstatus).toBe(0);

    // Third call submits it
    const submit = transport.sent[2]!;
    expect(submit.method).toBe("PUT");
    expect(submit.body).toEqual({ docstatus: 1 });

    // Wait, url.pathname might be URL encoded. Let's just check the body.
    const body = call.body as any;
    expect(body.doctype).toBe("Sales Invoice");
    expect(body.items).toHaveLength(1);
    expect(body.items[0].qty).toBe(2);
    expect(body.amburax_sale_id).toBe(saleId);
    expect(body.set_warehouse).toBe("Test Warehouse");

    // 6. Verify Sale row updated
    const updatedSale = await db.sale.findUnique({ where: { id: saleId } });
    expect(updatedSale?.erpSyncStatus).toBe("SYNCED");
    expect(updatedSale?.erpInvoiceId).toBe("SINV-00001");
  });
});
