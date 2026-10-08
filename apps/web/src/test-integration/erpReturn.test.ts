import { describe, it, expect, beforeEach } from "vitest";
import { db, IDS, COMMERCE_IDS, resetDatabase, seedTwoTenants, seedCommerce } from "./db";
import { createSale } from "@/server/sales/saleService";
import { createReturn, ReturnDomainError } from "@/server/sales/returnService";
import { FakeErpTransport } from "@/server/erp/fakeTransport";
import { ErpSaleAdapter } from "@/server/erp/saleAdapter";
import { ErpReturnAdapter } from "@/server/erp/returnAdapter";
import { ErpOutboxPublisher } from "@/server/erp/outboxPublisher";
import { dispatchOutboxOnce } from "@/server/events/outboxDispatcher";
import { randomUUID } from "crypto";

describe("ERPNext Vertical Slice (Returns)", () => {
  let transport: FakeErpTransport;
  let publisher: ErpOutboxPublisher;

  beforeEach(async () => {
    await resetDatabase();
    await seedTwoTenants();
    await seedCommerce();
    transport = new FakeErpTransport();
    publisher = new ErpOutboxPublisher(
      new ErpSaleAdapter(transport),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new ErpReturnAdapter(transport)
    );
  });

  it("completes a return, creates outbox event, and syncs to ERPNext as Return Invoice", async () => {
    const tenantId = IDS.tenantA;
    const storeId = IDS.storeA;
    const userId = IDS.ownerA;

    await db.tenant.update({
      where: { id: tenantId },
      data: { erpnextProvisionStatus: "PROVISIONED", erpnextSiteId: "test-site.local" },
    });
    process.env["ERP_SITE_TEST_SITE_LOCAL_URL"] = "http://test-site.local";
    process.env["ERP_SITE_TEST_SITE_LOCAL_KEY"] = "test-key";
    process.env["ERP_SITE_TEST_SITE_LOCAL_SECRET"] = "test-secret";

    await db.store.update({
      where: { id: storeId },
      data: { erpnextWarehouseId: "Test Warehouse" },
    });

    // 1. Make a SALE first
    transport.script(
      { kind: "respond", status: 200, body: { data: [] } }, 
      { kind: "respond", status: 200, body: { data: { name: "SINV-00001" } } } 
    );
    const saleResult = await createSale({
      tenantId, storeId, cashierUserId: userId, correlationId: randomUUID(), idempotencyKey: randomUUID(),
      lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 2 }],
      payment: { method: "CASH", amountMinor: 200_000 },
    });
    if (saleResult.status !== "ok") {
      throw new Error(`Sale failed: ${saleResult.status}`);
    }
    const saleId = saleResult.sale.id;
    await dispatchOutboxOnce({ tenantId, publisher });

    const originalSale = await db.sale.findUnique({ where: { id: saleId }, include: { items: true } });
    if (!originalSale) throw new Error("not found");
    expect(originalSale.erpInvoiceId).toBe("SINV-00001");
    const originalItemId = originalSale.items[0]!.id;

    // 2. Make a RETURN
    transport.script(
      { kind: "respond", status: 200, body: { data: [] } }, 
      { kind: "respond", status: 200, body: { data: { name: "RET-SINV-00001" } } } 
    );

    const returnResult = await createReturn({
      tenantId, storeId, originalSaleId: saleId, idempotencyKey: randomUUID(),
      items: [{ originalSaleItemId: originalItemId, quantity: 1 }],
      refundPayments: [{ method: "CASH", amountMinor: 100_000 }]
    });

    const returnId = returnResult.saleReturn.id;

    // Verify outbox event created
    const outboxEvents = await db.outboxEvent.findMany({
      where: { tenantId, entityId: returnId, eventType: "SaleReturnCreated" },
    });
    expect(outboxEvents).toHaveLength(1);
    expect(outboxEvents[0]?.publishedAt).toBeNull();

    // Dispatch outbox for the return
    await dispatchOutboxOnce({ tenantId, publisher });

    const publishedEvent = await db.outboxEvent.findUnique({ where: { id: outboxEvents[0]!.id } });
    expect(publishedEvent?.publishedAt).not.toBeNull();
    expect(publishedEvent?.lastError).toBeNull();

    // Verify ERP transport payload
    const returnCall = transport.sent.find(s => s.method === "POST" && (s.body as any)?.is_return === 1);
    expect(returnCall).toBeDefined();
    
    const body = returnCall!.body as any;
    expect(body.doctype).toBe("Sales Invoice");
    expect(body.is_return).toBe(1);
    expect(body.return_against).toBe("SINV-00001");
    expect(body.items).toHaveLength(1);
    expect(body.items[0].qty).toBe(-1); // negative for return
    expect(body.items[0].rate).toBeGreaterThan(0); // positive rate
    expect(body.payments[0].amount).toBeLessThan(0); // negative payment
    expect(body.amburax_sale_id).toBe(returnId); // mapped to return ID

    // Verify Return row updated
    const updatedReturn = await db.saleReturn.findUnique({ where: { id: returnId } });
    expect(updatedReturn?.erpSyncStatus).toBe("SYNCED");
    expect(updatedReturn?.erpInvoiceId).toBe("RET-SINV-00001");
  });

  it("idempotency retry (response lost from ERP)", async () => {
    // Boilerplate setup
    const tenantId = IDS.tenantA;
    const storeId = IDS.storeA;
    await db.tenant.update({ where: { id: tenantId }, data: { erpnextProvisionStatus: "PROVISIONED", erpnextSiteId: "test-site.local" }});
    process.env["ERP_SITE_TEST_SITE_LOCAL_URL"] = "http://test-site.local";
    process.env["ERP_SITE_TEST_SITE_LOCAL_KEY"] = "test-key";
    process.env["ERP_SITE_TEST_SITE_LOCAL_SECRET"] = "test-secret";
    await db.store.update({ where: { id: storeId }, data: { erpnextWarehouseId: "Test Warehouse" }});

    transport.script({ kind: "respond", status: 200, body: { data: [] } }, { kind: "respond", status: 200, body: { data: { name: "SINV-00001" } } });
    const saleResult = await createSale({
      tenantId, storeId, cashierUserId: IDS.ownerA, correlationId: randomUUID(), idempotencyKey: randomUUID(),
      lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 2 }],
      payment: { method: "CASH", amountMinor: 200_000 },
    });
    if (saleResult.status !== "ok") {
      throw new Error(`Sale failed: ${saleResult.status}`);
    }
    const saleId = saleResult.sale.id;
    await dispatchOutboxOnce({ tenantId, publisher });

    const originalSale = await db.sale.findUnique({ where: { id: saleId }, include: { items: true } });
    if (!originalSale) throw new Error("not found");
    const originalItemId = originalSale.items[0]!.id;

    const returnResult = await createReturn({
      tenantId, storeId, originalSaleId: saleId, idempotencyKey: randomUUID(),
      items: [{ originalSaleItemId: originalItemId, quantity: 1 }],
      refundPayments: [{ method: "CASH", amountMinor: 100_000 }]
    });

    const returnId = returnResult.saleReturn.id;

    // Return Sync: Simulate Network Error on first POST, but ERP created the doc.
    transport.script(
      { kind: "respond", status: 200, body: { data: [] } }, // lookup initially empty
      { kind: "timeout" },    // create fails due to network
      { kind: "respond", status: 200, body: { data: [{ name: "RET-SINV-00001" }] } } // fallback lookup finds it!
    );

    // It should succeed gracefully on the first dispatch because fallback lookup finds it
    await dispatchOutboxOnce({ tenantId, publisher });

    const updatedReturn = await db.saleReturn.findUnique({ where: { id: returnId } });
    expect(updatedReturn?.erpSyncStatus).toBe("SYNCED");
    expect(updatedReturn?.erpInvoiceId).toBe("RET-SINV-00001");
  });
});
