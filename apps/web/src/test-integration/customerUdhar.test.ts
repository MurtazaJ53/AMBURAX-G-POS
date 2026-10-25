import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { db, resetDatabase, seedTwoTenants, seedCommerce, IDS, COMMERCE_IDS } from "./db";
import { createCustomer, searchCustomers, getCustomerDue } from "@/server/sales/customers";
import { createSale } from "@/server/sales/saleService";
import { getKhataBook } from "@/server/khata/khataBook";
import { ErpKhataService, KhataPaymentsUnavailableError } from "@/server/khata/khataService";
import type { ErpTransport, ErpRequest, ErpResponse } from "@/server/erp/transport";
import { ErpSaleAdapter } from "@/server/erp/saleAdapter";
import { ErpCatalogAdapter } from "@/server/erp/catalogAdapter";
import { ErpStoreAdapter } from "@/server/erp/storeAdapter";
import { ErpInventoryAdapter } from "@/server/erp/inventoryAdapter";
import { ErpOutboxPublisher } from "@/server/erp/outboxPublisher";
import { dispatchOutboxOnce } from "@/server/events/outboxDispatcher";
import { enqueueOutboxEvent } from "@/server/events/outbox";

/**
 * The counter's customer flow end to end, against real PostgreSQL: a mobile number identifies a
 * person whatever way it is typed, udhar (khata credit) is given at the till within the rules,
 * collected later, and reaches the ledger owner as an outstanding receivable.
 */

const T = IDS.tenantA;
let seq = 0;
const key = (p: string) => `${p}-${++seq}-${Date.now()}`;

/** A one-line sale of the fixture shirt. */
async function bill(extra: Partial<Parameters<typeof createSale>[0]> = {}) {
  return createSale({
    tenantId: T,
    storeId: IDS.storeA,
    cashierUserId: IDS.ownerA,
    idempotencyKey: key("sale"),
    lines: [{ variantId: COMMERCE_IDS.variantA1, quantity: 1 }],
    correlationId: "corr-udhar",
    ...extra,
  });
}

/** The fixture bill's total, read from a priced sale rather than hard-coded; the probe is removed. */
async function billTotal(): Promise<number> {
  const probe = await bill({ payment: { method: "CASH" } });
  if (probe.status !== "ok") throw new Error(probe.status);
  return probe.sale.totalMinor;
}

beforeEach(async () => {
  seq = 0;
  await resetDatabase();
  await seedTwoTenants();
  await seedCommerce();
});

afterAll(async () => {
  await resetDatabase();
});

describe("one mobile number, one customer", () => {
  it("stores a number in one spelling, however it was typed", async () => {
    const res = await createCustomer({ tenantId: T, name: "Priya Sharma", phone: "98765 43210" });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.customer.phone).toBe("+919876543210");
    expect(res.existing).toBe(false);
  });

  it("finds the existing customer instead of creating a duplicate", async () => {
    await createCustomer({ tenantId: T, name: "Priya Sharma", phone: "9876543210" });
    const again = await createCustomer({ tenantId: T, name: "Priya S", phone: "+91 98765-43210" });
    expect(again.status === "ok" && again.existing).toBe(true);
    expect(await db.customer.count({ where: { tenantId: T, name: { startsWith: "Priya" } } })).toBe(1);
  });

  it("recognises a number saved before numbers were normalised", async () => {
    await db.customer.create({ data: { tenantId: T, name: "Old Record", phone: "9811122233" } });
    const res = await createCustomer({ tenantId: T, name: "New Typing", phone: "+919811122233" });
    expect(res.status === "ok" && res.existing && res.customer.name).toBe("Old Record");
  });

  it("search matches a number typed with spaces or a country code", async () => {
    await createCustomer({ tenantId: T, name: "Priya Sharma", phone: "9876543210" });
    for (const q of ["98765 43210", "+91 98765 43210", "43210"]) {
      const hits = await searchCustomers({ tenantId: T, query: q });
      expect(hits.map((h) => h.name)).toContain("Priya Sharma");
    }
  });

  it("never finds another tenant's customer", async () => {
    const hits = await searchCustomers({ tenantId: T, query: "9000000002" });
    expect(hits).toEqual([]);
  });
});

describe("validation on every field", () => {
  it.each([
    [{ name: "9876543210", phone: "9876500000" }, "name"],
    [{ name: "Ravi Kumar", phone: "12345" }, "phone"],
    [{ name: "Ravi Kumar", phone: "5876543210" }, "phone"],
    [{ name: "Ravi Kumar", phone: "9876500001", email: "ravi@mail" }, "email"],
    [{ name: "Ravi Kumar", phone: "9876500002", gstin: "NOTAGSTIN" }, "gstin"],
  ])("refuses %j on %s and writes nothing", async (input, field) => {
    const before = await db.customer.count();
    const res = await createCustomer({ tenantId: T, ...input });
    expect(res).toMatchObject({ status: "validation_error", field });
    expect(await db.customer.count()).toBe(before);
  });

  it("stores e-mail lowercase and GSTIN uppercase", async () => {
    const res = await createCustomer({
      tenantId: T,
      name: "Kapoor Traders",
      phone: "9876500003",
      email: "Accounts@Kapoor.IN",
      gstin: "27abcde1234f1z5",
    });
    expect(res.status).toBe("ok");
    const row = await db.customer.findFirstOrThrow({ where: { tenantId: T, name: "Kapoor Traders" } });
    expect(row.email).toBe("accounts@kapoor.in");
    expect(row.gstin).toBe("27ABCDE1234F1Z5");
  });
});

describe("udhar at the till", () => {
  it("fails closed on onAccountMinor > 0 because credit facility and verification evidence are unavailable", async () => {
    const total = await billTotal();
    // billTotal() rings a cash probe sale, so compare against the counts just before the refusal.
    const salesBefore = await db.sale.count();
    const paymentsBefore = await db.salePayment.count();
    const res = await bill({ customerId: COMMERCE_IDS.customerA, onAccountMinor: total });
    expect(res.status).toBe("credit_facility_unavailable");
    if (res.status !== "credit_facility_unavailable") return;
    expect(res.reason).toContain("isn't linked to a company");
    expect(await db.sale.count()).toBe(salesBefore);
    expect(await db.salePayment.count()).toBe(paymentsBefore);
  });

  it("fails closed when split on-account is attempted", async () => {
    const total = await billTotal();
    const salesBefore = await db.sale.count();
    const paymentsBefore = await db.salePayment.count();
    const res = await bill({
      customerId: COMMERCE_IDS.customerA,
      onAccountMinor: total - 30_000,
      payment: { method: "UPI", amountMinor: 30_000 },
    });
    expect(res.status).toBe("credit_facility_unavailable");
    expect(await db.sale.count()).toBe(salesBefore);
    expect(await db.salePayment.count()).toBe(paymentsBefore);
  });

  it("general customer search preserves privacy and does not expose due balances", async () => {
    const [hit] = await searchCustomers({ tenantId: T, query: "9000000001" });
    expect(hit).toBeDefined();
    expect(hit).not.toHaveProperty("dueMinor");
    // Balance is authoritative and queried tenant-scoped after selection
    const due = await getCustomerDue({ tenantId: T, customerId: COMMERCE_IDS.customerA });
    expect(due).toBe(0);
  });

  it.each([
    ["without a customer", { onAccountMinor: 10_000, payment: { method: "CASH" as const } }, "Add the customer"],
    ["above the bill total", { customerId: COMMERCE_IDS.customerA, onAccountMinor: 99_999_999 }, "cannot be more than the bill total"],
    ["with a negative amount", { customerId: COMMERCE_IDS.customerA, onAccountMinor: -1 }, "valid udhar amount"],
  ])("is refused %s, and nothing is written", async (_label, extra, message) => {
    const res = await bill(extra);
    expect(res.status).toBe("validation_error");
    expect(res.status === "validation_error" && res.reason).toContain(message);
    expect(await db.sale.count()).toBe(0);
  });
});

/**
 * The read-only khata book against real PostgreSQL, with explicit Company/Store/currency scope.
 *
 * On-account checkout stays fail-closed (see "udhar at the till"), so pending udhar cannot be
 * rung through createSale. Pending sales are therefore persisted as fixtures with the same
 * shape createSale writes. Khata payment collection is disabled until allocation is approved,
 * so scoped payments the read-only book must account for are persisted as fixtures too.
 */
const COMPANY_1 = "co-aaaaaaaaaaaaaaaaaaaaaa1";
const COMPANY_2 = "co-aaaaaaaaaaaaaaaaaaaaaa2";
const STORE_2 = "s-aaaaaaaaaaaaaaaaaaaaaaa2";

async function seedCompanies() {
  await db.company.createMany({
    data: [
      { id: COMPANY_1, tenantId: T, name: "Company One", code: "C1", currency: "INR" },
      { id: COMPANY_2, tenantId: T, name: "Company Two", code: "C2", currency: "INR" },
    ],
  });
  await db.store.update({ where: { id: IDS.storeA }, data: { companyId: COMPANY_1 } });
  await db.store.create({
    data: {
      id: STORE_2,
      tenantId: T,
      name: "Store A2",
      code: "SA2",
      currency: "INR",
      addressLine: "2 A Street",
      city: "Mumbai",
      state: "MH",
      companyId: COMPANY_2,
    },
  });
}

/** A completed pending-udhar sale, persisted directly because on-account checkout is gated. */
async function pendingSale(opts: {
  storeId?: string;
  companyId: string | null;
  currency: string | null;
  onAccountMinor: number;
  daysAgo?: number;
}) {
  return db.sale.create({
    data: {
      tenantId: T,
      storeId: opts.storeId ?? IDS.storeA,
      companyId: opts.companyId,
      currencySnapshot: opts.currency,
      billNumber: key("FIX"),
      cashierUserId: IDS.ownerA,
      customerId: COMMERCE_IDS.customerA,
      subtotalMinor: opts.onAccountMinor,
      taxMinor: 0,
      totalMinor: opts.onAccountMinor,
      paidMinor: 0,
      initialOnAccountMinor: opts.onAccountMinor,
      idempotencyKey: key("fix-sale"),
      completedAt: new Date(Date.now() - (opts.daysAgo ?? 1) * 86_400_000),
      dueDateSnapshot: new Date(Date.now() + 14 * 86_400_000),
      effectiveTermsDaysSnapshot: 15,
    },
  });
}

/** A company-scoped khata payment row, persisted directly because collection is disabled. */
async function scopedPayment(opts: {
  companyId: string | null;
  currency: string | null;
  amountMinor: number;
  paymentMethod?: "CASH" | "UPI" | "CARD";
}) {
  return db.khataPayment.create({
    data: {
      tenantId: T,
      customerId: COMMERCE_IDS.customerA,
      actorUserId: IDS.ownerA,
      amountMinor: opts.amountMinor,
      paymentMethod: opts.paymentMethod ?? "CASH",
      idempotencyKey: key("fix-pay"),
      companyId: opts.companyId,
      currency: opts.currency,
    },
  });
}

const scope1 = { tenantId: T, companyId: COMPANY_1, currency: "INR" };

describe("scope is persisted from the Store", () => {
  beforeEach(seedCompanies);

  it("a new sale at a mapped Store carries that Store's company and currency", async () => {
    const res = await bill({ payment: { method: "CASH" } });
    if (res.status !== "ok") throw new Error(res.status);
    const row = await db.sale.findUniqueOrThrow({ where: { id: res.sale.id } });
    expect(row).toMatchObject({ companyId: COMPANY_1, currencySnapshot: "INR" });
  });

  it("a new sale at an unmapped Store carries no scope rather than an invented one", async () => {
    await db.store.update({ where: { id: IDS.storeA }, data: { companyId: null } });
    const res = await bill({ payment: { method: "CASH" } });
    if (res.status !== "ok") throw new Error(res.status);
    const row = await db.sale.findUniqueOrThrow({ where: { id: res.sale.id } });
    expect(row).toMatchObject({ companyId: null, currencySnapshot: null });
  });

  it("a Store whose currency differs from its Company's is treated as unmapped", async () => {
    await db.store.update({ where: { id: IDS.storeA }, data: { currency: "USD" } });
    const res = await bill({ payment: { method: "CASH" } });
    if (res.status !== "ok") throw new Error(res.status);
    const row = await db.sale.findUniqueOrThrow({ where: { id: res.sale.id } });
    expect(row).toMatchObject({ companyId: null, currencySnapshot: null });
  });

  it("khata payment collection is refused even at a mapped Store, writing nothing", async () => {
    for (const storeId of [IDS.storeA, STORE_2, IDS.storeB]) {
      await expect(
        new ErpKhataService().collectCustomerPayment({
          tenantId: T,
          customerId: COMMERCE_IDS.customerA,
          actorUserId: IDS.ownerA,
          storeId,
          amountMinor: 1_000,
          idempotencyKey: key("khata"),
        }),
      ).rejects.toBeInstanceOf(KhataPaymentsUnavailableError);
    }
    expect(await db.khataPayment.count()).toBe(0);
    expect(await db.outboxEvent.count({ where: { eventType: "CustomerPaymentCollected" } })).toBe(0);
  });
});

describe("the khata book", () => {
  beforeEach(seedCompanies);

  it("shows a pending sale less a scoped payment, and the ledger reads in order", async () => {
    await pendingSale({ companyId: COMPANY_1, currency: "INR", onAccountMinor: 100_000 });
    await scopedPayment({ companyId: COMPANY_1, currency: "INR", amountMinor: 40_000, paymentMethod: "UPI" });

    const book = await getKhataBook(scope1);
    expect(book.totalDueMinor).toBe(60_000);
    expect(book.activeKhata).toBe(1);
    const [c] = book.customers;
    expect(c?.name).toBe("Customer A");
    expect(c?.entries.map((e) => [e.kind, e.amountMinor, e.balanceMinor])).toEqual([
      ["PAYMENT", -40_000, 60_000],
      ["UDHAR", 100_000, 100_000],
    ]);
    expect(book.recentPayments[0]).toMatchObject({ amountMinor: 40_000, method: "UPI" });
  });

  it("a customer who has paid everything drops off the book", async () => {
    await pendingSale({ companyId: COMPANY_1, currency: "INR", onAccountMinor: 50_000 });
    await scopedPayment({ companyId: COMPANY_1, currency: "INR", amountMinor: 50_000 });
    const book = await getKhataBook(scope1);
    expect(book.customers).toEqual([]);
    expect(book.totalDueMinor).toBe(0);
  });

  it("ages a due from its oldest unpaid bill and marks it overdue past its due date", async () => {
    const sale = await pendingSale({ companyId: COMPANY_1, currency: "INR", onAccountMinor: 70_000, daysAgo: 40 });
    await db.sale.update({ where: { id: sale.id }, data: { dueDateSnapshot: new Date(Date.now() - 25 * 86_400_000) } });

    const book = await getKhataBook(scope1);
    expect(book.customers[0]).toMatchObject({ daysPending: 40, status: "OVERDUE" });
    expect(book.ageing.find((a) => a.label === "31 - 60 Days")?.minor).toBe(70_000);
    expect(book.overdueCustomers).toBe(1);
  });

  it("another company's and unmapped legacy records never enter the selected company's totals", async () => {
    await pendingSale({ companyId: COMPANY_1, currency: "INR", onAccountMinor: 10_000 });
    await pendingSale({ storeId: STORE_2, companyId: COMPANY_2, currency: "INR", onAccountMinor: 20_000 });
    await pendingSale({ companyId: null, currency: null, onAccountMinor: 40_000 });
    // A company-two payment and a legacy null-scoped payment must not settle company one.
    await scopedPayment({ companyId: COMPANY_2, currency: "INR", amountMinor: 5_000 });
    await scopedPayment({ companyId: null, currency: null, amountMinor: 5_000 });

    const one = await getKhataBook(scope1);
    expect(one.totalDueMinor).toBe(10_000);
    expect(one.recentPayments).toEqual([]);

    const two = await getKhataBook({ ...scope1, companyId: COMPANY_2 });
    expect(two.totalDueMinor).toBe(15_000);
    expect(two.recentPayments).toHaveLength(1);
  });

  it("another tenant cannot read this tenant's company book", async () => {
    await pendingSale({ companyId: COMPANY_1, currency: "INR", onAccountMinor: 10_000 });
    const book = await getKhataBook({ ...scope1, tenantId: IDS.tenantB });
    expect(book.totalDueMinor).toBe(0);
    expect(book.customers).toEqual([]);
  });
});

/** Answers by path, so the whole sale sync can run without scripting every call in order. */
class RoutedTransport implements ErpTransport {
  readonly sent: ErpRequest[] = [];
  async send(request: ErpRequest): Promise<ErpResponse> {
    this.sent.push(request);
    // The posting guard asks which company owns the store's warehouse.
    if (request.method === "GET" && decodeURIComponent(request.path).startsWith("/api/resource/Warehouse/")) return { status: 200, body: { data: { company: "Amburax Retail" } } };
    if (request.method === "GET" && request.path.includes("/Customer")) return { status: 200, body: { data: [{ name: "CUST-A" }] } };
    if (request.method === "POST" && request.path.includes("Sales Invoice")) return { status: 200, body: { data: { name: "SINV-1" } } };
    return { status: 200, body: { data: [] } };
  }
}

describe("sync", () => {
  it("sends an udhar bill as a submitted invoice paying only what was paid, on the customer's account", async () => {
    await db.tenant.update({ where: { id: T }, data: { erpnextProvisionStatus: "PROVISIONED", erpnextCompanyId: "Amburax Retail", erpnextSiteId: "test-site.local" } });
    await db.store.update({ where: { id: IDS.storeA }, data: { erpnextProvisionStatus: "PROVISIONED", erpnextWarehouseId: "Stores - AR" } });
    process.env["ERP_SITE_TEST_SITE_LOCAL_URL"] = "http://test-site.local";
    process.env["ERP_SITE_TEST_SITE_LOCAL_KEY"] = "test-key";
    process.env["ERP_SITE_TEST_SITE_LOCAL_SECRET"] = "test-secret";

    const transport = new RoutedTransport();
    const publisher = new ErpOutboxPublisher(
      new ErpSaleAdapter(transport),
      new ErpCatalogAdapter(transport),
      new ErpStoreAdapter(transport),
      new ErpInventoryAdapter(transport),
    );

    // On-account checkout is gated, so the udhar bill is seeded in the shape createSale writes
    // (company-scoped sale, line, confirmed cash tender, SaleCompleted outbox event) instead of
    // being rung through the till.
    await seedCompanies();
    const unitPriceMinor = 100_000;
    const sale = await pendingSale({ companyId: COMPANY_1, currency: "INR", onAccountMinor: unitPriceMinor - 25_000 });
    await db.sale.update({
      where: { id: sale.id },
      data: { subtotalMinor: unitPriceMinor, totalMinor: unitPriceMinor, paidMinor: 25_000 },
    });
    const variant = await db.productVariant.findUniqueOrThrow({
      where: { id: COMMERCE_IDS.variantA1 },
      include: { product: true },
    });
    await db.saleItem.create({
      data: {
        tenantId: T,
        saleId: sale.id,
        variantId: variant.id,
        skuSnapshot: variant.sku,
        nameSnapshot: variant.product.name,
        quantity: 1,
        unitPriceMinor,
        taxRateBp: 0,
        taxMinor: 0,
        lineTotalMinor: unitPriceMinor,
      },
    });
    await db.salePayment.create({
      data: { saleId: sale.id, method: "CASH", status: "CONFIRMED", amountMinor: 25_000, confirmedAt: new Date() },
    });
    await db.$transaction((tx) =>
      enqueueOutboxEvent(tx, {
        tenantId: T,
        storeId: IDS.storeA,
        eventType: "SaleCompleted",
        actorUserId: IDS.ownerA,
        correlationId: "corr-udhar-sync",
        entityId: sale.id,
        payload: { billNumber: sale.billNumber, totalMinor: unitPriceMinor, customerId: COMMERCE_IDS.customerA, onAccountMinor: unitPriceMinor - 25_000 },
      }),
    );

    await dispatchOutboxOnce({ publisher });

    const udhar = transport.sent
      .filter((r) => r.method === "POST" && r.path.includes("Sales Invoice"))
      .map((r) => r.body as Record<string, unknown>)
      .find((b) => b["amburax_sale_id"] === sale.id);
    expect(udhar).toBeDefined();
    // Created as a draft (so its currency can be checked), then submitted by a separate call.
    expect(udhar!["docstatus"]).toBe(0);
    expect(
      transport.sent.some((r) => r.method === "PUT" && r.path.includes("SINV-1") && (r.body as { docstatus?: number })?.docstatus === 1),
    ).toBe(true);
    expect(udhar!["customer"]).toBe("CUST-A");
    expect(udhar!["payments"]).toEqual([{ mode_of_payment: "Cash", amount: 250 }]);
  });
});
