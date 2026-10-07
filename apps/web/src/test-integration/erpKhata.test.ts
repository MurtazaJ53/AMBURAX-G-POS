import { describe, it, expect, beforeEach } from "vitest";
import { db, IDS, resetDatabase, seedTwoTenants } from "./db";
import { ErpKhataService } from "@/server/khata/khataService";
import { ErpPaymentAdapter } from "@/server/erp/paymentAdapter";
import { FakeErpTransport } from "@/server/erp/fakeTransport";
import { ErpOutboxPublisher } from "@/server/erp/outboxPublisher";
import { dispatchOutboxOnce } from "@/server/events/outboxDispatcher";
import { ErpSaleAdapter } from "@/server/erp/saleAdapter";
import { ErpCatalogAdapter } from "@/server/erp/catalogAdapter";
import { ErpStoreAdapter } from "@/server/erp/storeAdapter";
import { ErpInventoryAdapter } from "@/server/erp/inventoryAdapter";
import { ErpCustomerAdapter } from "@/server/erp/customerAdapter";
import { createCustomer } from "@/server/sales/customers";

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

describe("ERPNext Khata / Receivables & Payments", () => {
  let transport: FakeErpTransport;
  let publisher: ErpOutboxPublisher;
  let khataService: ErpKhataService;

  beforeEach(async () => {
    await resetDatabase();
    await seedTwoTenants();

    transport = new FakeErpTransport();
    publisher = new ErpOutboxPublisher(
      new ErpSaleAdapter(transport),
      new ErpCatalogAdapter(transport),
      new ErpStoreAdapter(transport),
      new ErpInventoryAdapter(transport),
      new ErpCustomerAdapter(transport),
      new ErpPaymentAdapter(transport)
    );
    khataService = new ErpKhataService(transport);

    process.env["ERP_SITE_TEST_SITE_LOCAL_URL"] = "http://test-site.local";
    process.env["ERP_SITE_TEST_SITE_LOCAL_KEY"] = "test-key";
    process.env["ERP_SITE_TEST_SITE_LOCAL_SECRET"] = "test-secret";
  });

  it("queries customer receivables from ERPNext with truthful status and days pending", async () => {
    const tenantId = IDS.tenantA;
    const storeId = IDS.storeA;
    await provisionTenantForErp(tenantId, storeId);

    const custRes = await createCustomer({
      tenantId,
      name: "Rohan Varma",
      phone: "9876543210",
      actorUserId: IDS.ownerA,
      correlationId: "corr-rohan-1",
    });
    if (custRes.status !== "ok") throw new Error("Customer creation failed");

    // Script Fake ERP transport:
    // 1. GET /api/resource/Customer?filters=[["customer_pos_id","=",...]] -> returns name: "Rohan Varma"
    // 2. GET /api/resource/Sales Invoice?filters=[["customer","=","Rohan Varma"],...] -> returns 2 invoices
    transport.script(
      {
        kind: "respond",
        status: 200,
        body: { data: [{ name: "Rohan Varma" }] },
      },
      {
        kind: "respond",
        status: 200,
        body: {
          data: [
            {
              name: "SINV-001",
              customer: "Rohan Varma",
              outstanding_amount: 50.0,
              grand_total: 100.0,
              posting_date: "2026-09-01",
              due_date: "2026-09-15",
              status: "Overdue",
            },
            {
              name: "SINV-002",
              customer: "Rohan Varma",
              outstanding_amount: 150.0,
              grand_total: 150.0,
              posting_date: "2026-10-05",
              due_date: "2026-10-25",
              status: "Unpaid",
            },
          ],
        },
      }
    );

    const receivables = await khataService.getCustomerReceivables({
      tenantId,
      customerId: custRes.customer.id,
      correlationId: "test-receivables",
    });

    expect(receivables.customerId).toBe(custRes.customer.id);
    expect(receivables.erpCustomerName).toBe("Rohan Varma");
    expect(receivables.invoicesCount).toBe(2);
    expect(receivables.totalDueMinor).toBe(20000); // 50 + 150 = 200.00
    expect(receivables.overdueMinor).toBe(5000); // 50.00 overdue
    expect(receivables.invoices[0]?.name).toBe("SINV-001");
    expect(receivables.invoices[0]?.status).toBe("Overdue");
  });

  it("collects a payment, enqueues outbox event, and syncs Payment Entry to ERPNext", async () => {
    const tenantId = IDS.tenantA;
    const storeId = IDS.storeA;
    await provisionTenantForErp(tenantId, storeId);

    const custRes = await createCustomer({
      tenantId,
      name: "Rohan Varma",
      phone: "9876543210",
      actorUserId: IDS.ownerA,
      correlationId: "corr-rohan-2",
    });
    if (custRes.status !== "ok") throw new Error("Customer creation failed");

    // Script fake transport for CustomerCreated sync & drain it
    transport.script(
      { kind: "respond", status: 200, body: { data: [] } },
      { kind: "respond", status: 200, body: { data: { name: "Rohan Varma" } } }
    );
    await dispatchOutboxOnce({ publisher });
    (transport.sent as any[]).length = 0;

    // Script Fake ERP transport for CustomerPaymentCollected dispatch:
    // 1. GET /api/resource/Payment Entry?filters=remarks like amburax-payment-id:... -> [] (idempotency check)
    // 2. GET /api/resource/Customer?filters=[["customer_pos_id",...]] -> name: "Rohan Varma"
    // 3. GET /api/resource/Sales Invoice?filters=[["customer","=","Rohan Varma"]...] -> open invoices
    // 4. POST /api/resource/Payment Entry -> { name: "ACC-PAY-999" }
    transport.script(
      { kind: "respond", status: 200, body: { data: [] } },
      { kind: "respond", status: 200, body: { data: [{ name: "Rohan Varma" }] } },
      {
        kind: "respond",
        status: 200,
        body: {
          data: [
            {
              name: "SINV-001",
              outstanding_amount: 50.0,
              grand_total: 100.0,
              posting_date: "2026-09-01",
            },
            {
              name: "SINV-002",
              outstanding_amount: 150.0,
              grand_total: 150.0,
              posting_date: "2026-10-05",
            },
          ],
        },
      },
      { kind: "respond", status: 200, body: { data: { name: "ACC-PAY-999" } } }
    );

    const collectRes = await khataService.collectCustomerPayment({
      tenantId,
      customerId: custRes.customer.id,
      actorUserId: IDS.ownerA,
      amountMinor: 8000, // 80.00 collected (covers SINV-001 completely + 30.00 of SINV-002)
      paymentMethod: "CASH",
      notes: "Part payment cash",
      idempotencyKey: "idem-khata-pay-1",
    });

    expect(collectRes.duplicate).toBe(false);
    expect(collectRes.payment.amountMinor).toBe(8000);
    expect(collectRes.payment.erpSyncStatus).toBe("PENDING");

    // Dispatch Outbox
    const { published, failed } = await dispatchOutboxOnce({ publisher });
    expect(failed).toBe(0);
    expect(published).toBeGreaterThanOrEqual(1);

    // Verify local status updated
    const updated = await db.khataPayment.findUnique({
      where: { id: collectRes.payment.id },
    });
    expect(updated?.erpSyncStatus).toBe("SYNCED");
    expect(updated?.erpPaymentEntryId).toBe("ACC-PAY-999");

    // Verify ERPNext POST payload
    const postCalls = transport.sent.filter(
      (r) => r.method === "POST" && r.path.includes("Payment Entry")
    );
    expect(postCalls).toHaveLength(1);
    const postBody = postCalls[0]!.body as Record<string, unknown>;
    expect(postBody["doctype"]).toBe("Payment Entry");
    expect(postBody["party"]).toBe("Rohan Varma");
    expect(postBody["paid_amount"]).toBe(80);
    expect(postBody["received_amount"]).toBe(80);
    expect(postBody["docstatus"]).toBe(1);

    // Verify invoice allocations
    const references = postBody["references"] as Array<Record<string, unknown>>;
    expect(references).toHaveLength(2);
    expect(references[0]?.["reference_name"]).toBe("SINV-001");
    expect(references[0]?.["allocated_amount"]).toBe(50);
    expect(references[1]?.["reference_name"]).toBe("SINV-002");
    expect(references[1]?.["allocated_amount"]).toBe(30);
  });

  it("handles payment collection idempotency and duplicate prevention", async () => {
    const tenantId = IDS.tenantA;
    const storeId = IDS.storeA;
    await provisionTenantForErp(tenantId, storeId);

    const custRes = await createCustomer({
      tenantId,
      name: "Rohan Varma",
      phone: "9876543210",
      actorUserId: IDS.ownerA,
      correlationId: "corr-rohan-3",
    });
    if (custRes.status !== "ok") throw new Error("Customer creation failed");

    const first = await khataService.collectCustomerPayment({
      tenantId,
      customerId: custRes.customer.id,
      actorUserId: IDS.ownerA,
      amountMinor: 5000,
      idempotencyKey: "idem-dup-key-1",
    });
    expect(first.duplicate).toBe(false);

    // Replay with identical idempotencyKey
    const second = await khataService.collectCustomerPayment({
      tenantId,
      customerId: custRes.customer.id,
      actorUserId: IDS.ownerA,
      amountMinor: 5000,
      idempotencyKey: "idem-dup-key-1",
    });
    expect(second.duplicate).toBe(true);
    expect(second.payment.id).toBe(first.payment.id);

    // Verify only 1 outbox event exists
    const events = await db.outboxEvent.findMany({
      where: { tenantId, entityId: first.payment.id },
    });
    expect(events).toHaveLength(1);
  });
});
