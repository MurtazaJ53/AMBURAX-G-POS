import { describe, it, expect, beforeEach } from "vitest";
import { db, IDS, resetDatabase, seedTwoTenants } from "./db";
import { ErpKhataService, KhataPaymentsUnavailableError } from "@/server/khata/khataService";
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

/** Khata payments require the session Store to name a legal Company with a matching currency. */
async function mapStoreToCompany(tenantId: string, storeId: string) {
  const company = await db.company.create({ data: { tenantId, name: "Khata Co", code: "KC", currency: "INR" } });
  await db.store.update({ where: { id: storeId }, data: { companyId: company.id, currency: "INR" } });
}

async function provisionTenantForErp(tenantId: string, storeId: string) {
  await db.tenant.update({
    where: { id: tenantId },
    data: {
      erpnextProvisionStatus: "PROVISIONED", erpnextCompanyId: "Amburax Retail",
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

  // Payment collection is disabled until payment allocation is implemented and approved. These
  // replace the former collect-and-sync tests: the service must refuse before writing anything,
  // so no KhataPayment row, no outbox event, and no Payment Entry reaches ERPNext.
  it("refuses to collect a payment: no KhataPayment, no outbox event, no ERP call", async () => {
    const tenantId = IDS.tenantA;
    const storeId = IDS.storeA;
    await provisionTenantForErp(tenantId, storeId);
    await mapStoreToCompany(tenantId, storeId);

    const custRes = await createCustomer({
      tenantId,
      name: "Rohan Varma",
      phone: "9876543210",
      actorUserId: IDS.ownerA,
      correlationId: "corr-rohan-2",
    });
    if (custRes.status !== "ok") throw new Error("Customer creation failed");
    const outboxBefore = await db.outboxEvent.count();
    const sentBefore = transport.sent.length;

    await expect(
      khataService.collectCustomerPayment({
        tenantId,
        customerId: custRes.customer.id,
        actorUserId: IDS.ownerA,
        storeId,
        amountMinor: 8000,
        paymentMethod: "CASH",
        notes: "Part payment cash",
        idempotencyKey: "idem-khata-pay-1",
      }),
    ).rejects.toBeInstanceOf(KhataPaymentsUnavailableError);

    expect(await db.khataPayment.count()).toBe(0);
    expect(await db.outboxEvent.count()).toBe(outboxBefore);
    expect(await db.outboxEvent.count({ where: { eventType: "CustomerPaymentCollected" } })).toBe(0);
    expect(transport.sent.length).toBe(sentBefore);
  });

  it("refuses a replayed idempotency key the same way, writing nothing", async () => {
    const tenantId = IDS.tenantA;
    const storeId = IDS.storeA;
    await provisionTenantForErp(tenantId, storeId);
    await mapStoreToCompany(tenantId, storeId);

    const custRes = await createCustomer({
      tenantId,
      name: "Rohan Varma",
      phone: "9876543210",
      actorUserId: IDS.ownerA,
      correlationId: "corr-rohan-3",
    });
    if (custRes.status !== "ok") throw new Error("Customer creation failed");

    const attempt = () =>
      khataService.collectCustomerPayment({
        tenantId,
        customerId: custRes.customer.id,
        actorUserId: IDS.ownerA,
        storeId,
        amountMinor: 5000,
        idempotencyKey: "idem-dup-key-1",
      });

    await expect(attempt()).rejects.toBeInstanceOf(KhataPaymentsUnavailableError);
    await expect(attempt()).rejects.toBeInstanceOf(KhataPaymentsUnavailableError);
    expect(await db.khataPayment.count()).toBe(0);
    expect(await db.outboxEvent.count({ where: { eventType: "CustomerPaymentCollected" } })).toBe(0);
  });
});
