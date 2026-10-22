import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getKhataBook, KhataInconsistentError, KhataScopeError } from "@/server/khata/khataBook";
import { db } from "@/server/db";

vi.mock("@/server/db", () => ({
  db: {
    sale: { findMany: vi.fn() },
    khataReceivableEntry: { findMany: vi.fn() },
    khataPaymentAllocation: { findMany: vi.fn() },
    khataAdvanceAllocation: { findMany: vi.fn() },
    saleReturn: { findMany: vi.fn() },
    khataPayment: { findMany: vi.fn() },
    customer: { findMany: vi.fn() },
    company: { findUnique: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

describe("Khata Book Display & Multi-Company Scoping", () => {
  const tenantId = "ten-test";
  const companyId = "comp-1";
  const currency = "INR";
  const fixedNow = new Date("2026-10-15T10:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("criterion 1: completed persisted sale with outstanding balance appears for authorized legal company", async () => {
    // 1 completed sale with initial on-account balance
    vi.mocked(db.sale.findMany).mockResolvedValue([
      {
        id: "sale-1",
        billNumber: "INV-001",
        customerId: "cust-1",
        totalMinor: 100000, // ₹1,000.00
        paidMinor: 20000,   // ₹200.00 paid at till
        initialOnAccountMinor: 80000, // ₹800.00 on khata
        completedAt: new Date("2026-10-10T10:00:00.000Z"),
        dueDateSnapshot: new Date("2026-10-25T10:00:00.000Z"),
        effectiveTermsDaysSnapshot: 15,
      } as any,
    ]);

    vi.mocked(db.khataReceivableEntry.findMany).mockResolvedValue([]);
    vi.mocked(db.khataPaymentAllocation.findMany).mockResolvedValue([]);
    vi.mocked(db.khataAdvanceAllocation.findMany).mockResolvedValue([]);
    vi.mocked(db.saleReturn.findMany).mockResolvedValue([]);
    vi.mocked(db.khataPayment.findMany).mockResolvedValue([]);
    vi.mocked(db.company.findUnique).mockResolvedValue({ defaultPaymentTermsDays: 15 } as any);
    vi.mocked(db.customer.findMany).mockResolvedValue([
      {
        id: "cust-1",
        name: "Rahul Sharma",
        phone: "+919876543210",
        customerType: "REGULAR",
        creditLimitMinor: 200000,
        paymentTermsDays: 15,
      } as any,
    ]);
    vi.mocked(db.user.findMany).mockResolvedValue([]);

    const book = await getKhataBook({ tenantId, companyId, currency, now: fixedNow });

    expect(book.totalDueMinor).toBe(80000);
    expect(book.activeKhata).toBe(1);
    expect(book.customers).toHaveLength(1);
    expect(book.customers[0]?.name).toBe("Rahul Sharma");
    expect(book.customers[0]?.dueMinor).toBe(80000);
    expect(book.customers[0]?.dueDate).toEqual(new Date("2026-10-25T10:00:00.000Z"));
    expect(book.customers[0]?.status).toBe("ON_TRACK"); // 10 days left (> 7 days is ON_TRACK)
  });

  it("criterion 1b: overdue status when due date is in the past", async () => {
    vi.mocked(db.sale.findMany).mockResolvedValue([
      {
        id: "sale-overdue",
        billNumber: "INV-OD",
        customerId: "cust-od",
        totalMinor: 50000,
        paidMinor: 0,
        initialOnAccountMinor: 50000,
        completedAt: new Date("2026-09-01T10:00:00.000Z"),
        dueDateSnapshot: new Date("2026-09-15T10:00:00.000Z"), // in past relative to fixedNow 2026-10-15
        effectiveTermsDaysSnapshot: 14,
      } as any,
    ]);

    vi.mocked(db.khataReceivableEntry.findMany).mockResolvedValue([]);
    vi.mocked(db.khataPaymentAllocation.findMany).mockResolvedValue([]);
    vi.mocked(db.khataAdvanceAllocation.findMany).mockResolvedValue([]);
    vi.mocked(db.saleReturn.findMany).mockResolvedValue([]);
    vi.mocked(db.khataPayment.findMany).mockResolvedValue([]);
    vi.mocked(db.company.findUnique).mockResolvedValue(null);
    vi.mocked(db.customer.findMany).mockResolvedValue([
      {
        id: "cust-od",
        name: "Overdue Customer",
        phone: "+919876543200",
        customerType: "REGULAR",
        creditLimitMinor: 100000,
        paymentTermsDays: 14,
      } as any,
    ]);
    vi.mocked(db.user.findMany).mockResolvedValue([]);

    const book = await getKhataBook({ tenantId, companyId, currency, now: fixedNow });

    expect(book.overdueCustomers).toBe(1);
    expect(book.customers[0]?.status).toBe("OVERDUE");
  });

  it("criterion 2: payment reduces displayed balance once without duplicate accounting", async () => {
    // Sale with 80000 initial due
    vi.mocked(db.sale.findMany).mockResolvedValue([
      {
        id: "sale-1",
        billNumber: "INV-001",
        customerId: "cust-1",
        totalMinor: 100000,
        paidMinor: 20000,
        initialOnAccountMinor: 80000,
        completedAt: new Date("2026-10-10T10:00:00.000Z"),
        dueDateSnapshot: new Date("2026-10-25T10:00:00.000Z"),
        effectiveTermsDaysSnapshot: 15,
      } as any,
    ]);

    // Payment allocation of 30000 against sale-1
    vi.mocked(db.khataPaymentAllocation.findMany).mockResolvedValue([
      {
        id: "kpa-1",
        saleId: "sale-1",
        khataPaymentId: "pay-1",
        amountMinor: 30000,
      } as any,
    ]);

    // Payment of 30000 in khata_payments
    vi.mocked(db.khataPayment.findMany).mockResolvedValue([
      {
        id: "pay-1",
        customerId: "cust-1",
        actorUserId: "user-1",
        amountMinor: 30000,
        paymentMethod: "UPI",
        createdAt: new Date("2026-10-12T10:00:00.000Z"),
      } as any,
    ]);

    vi.mocked(db.khataReceivableEntry.findMany).mockResolvedValue([]);
    vi.mocked(db.khataAdvanceAllocation.findMany).mockResolvedValue([]);
    vi.mocked(db.saleReturn.findMany).mockResolvedValue([]);
    vi.mocked(db.company.findUnique).mockResolvedValue({ defaultPaymentTermsDays: 15 } as any);
    vi.mocked(db.customer.findMany).mockResolvedValue([
      {
        id: "cust-1",
        name: "Rahul Sharma",
        phone: "+919876543210",
        customerType: "REGULAR",
        creditLimitMinor: 200000,
        paymentTermsDays: 15,
      } as any,
    ]);
    vi.mocked(db.user.findMany).mockResolvedValue([{ id: "user-1", name: "Cashier Bob" } as any]);

    const book = await getKhataBook({ tenantId, companyId, currency, now: fixedNow });

    // Initial 80000 - 30000 = 50000. It must NOT be reduced twice to 20000!
    expect(book.totalDueMinor).toBe(50000);
    expect(book.customers[0]?.dueMinor).toBe(50000);
  });

  it("criterion 2b: fully settled dues are removed from active dues book", async () => {
    vi.mocked(db.sale.findMany).mockResolvedValue([
      {
        id: "sale-1",
        billNumber: "INV-001",
        customerId: "cust-1",
        totalMinor: 50000,
        paidMinor: 0,
        initialOnAccountMinor: 50000,
        completedAt: new Date("2026-10-10T10:00:00.000Z"),
        dueDateSnapshot: new Date("2026-10-25T10:00:00.000Z"),
        effectiveTermsDaysSnapshot: 15,
      } as any,
    ]);

    // Full repayment via khata payment
    vi.mocked(db.khataPaymentAllocation.findMany).mockResolvedValue([
      {
        id: "kpa-1",
        saleId: "sale-1",
        khataPaymentId: "pay-1",
        amountMinor: 50000,
      } as any,
    ]);
    vi.mocked(db.khataPayment.findMany).mockResolvedValue([
      {
        id: "pay-1",
        customerId: "cust-1",
        actorUserId: "user-1",
        amountMinor: 50000,
        paymentMethod: "CASH",
        createdAt: new Date("2026-10-11T10:00:00.000Z"),
      } as any,
    ]);
    vi.mocked(db.khataReceivableEntry.findMany).mockResolvedValue([]);
    vi.mocked(db.khataAdvanceAllocation.findMany).mockResolvedValue([]);
    vi.mocked(db.saleReturn.findMany).mockResolvedValue([]);
    vi.mocked(db.company.findUnique).mockResolvedValue({ defaultPaymentTermsDays: 15 } as any);
    vi.mocked(db.customer.findMany).mockResolvedValue([
      {
        id: "cust-1",
        name: "Rahul Sharma",
        phone: "+919876543210",
        customerType: "REGULAR",
        creditLimitMinor: 200000,
        paymentTermsDays: 15,
      } as any,
    ]);
    vi.mocked(db.user.findMany).mockResolvedValue([]);

    const book = await getKhataBook({ tenantId, companyId, currency, now: fixedNow });

    expect(book.totalDueMinor).toBe(0);
    expect(book.activeKhata).toBe(0);
    expect(book.customers).toHaveLength(0);
  });

  it("criterion 3: another company's sales or payments are strictly excluded", async () => {
    vi.mocked(db.sale.findMany).mockResolvedValue([]);
    vi.mocked(db.khataPayment.findMany).mockResolvedValue([]);
    vi.mocked(db.khataReceivableEntry.findMany).mockResolvedValue([]);
    vi.mocked(db.khataPaymentAllocation.findMany).mockResolvedValue([]);
    vi.mocked(db.khataAdvanceAllocation.findMany).mockResolvedValue([]);
    vi.mocked(db.saleReturn.findMany).mockResolvedValue([]);
    vi.mocked(db.company.findUnique).mockResolvedValue(null);

    const book = await getKhataBook({ tenantId, companyId: "comp-1", currency: "INR", now: fixedNow });

    expect(db.sale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: "comp-1",
          currencySnapshot: "INR",
          tenantId,
        }),
      }),
    );
    expect(db.khataPayment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          companyId: "comp-1",
          currency: "INR",
          tenantId,
        }),
      }),
    );
    expect(book.totalDueMinor).toBe(0);
    expect(book.customers).toHaveLength(0);
  });

  it("criterion 4: duplicate-count prevention across receivable ledger entries vs raw allocations", async () => {
    // Sale with ledger entries
    vi.mocked(db.sale.findMany).mockResolvedValue([
      {
        id: "sale-ledger",
        billNumber: "INV-LEDGER",
        customerId: "cust-2",
        totalMinor: 100000,
        paidMinor: 0,
        initialOnAccountMinor: 100000,
        completedAt: new Date("2026-10-01T10:00:00.000Z"),
        dueDateSnapshot: new Date("2026-10-15T10:00:00.000Z"),
        effectiveTermsDaysSnapshot: 14,
      } as any,
    ]);

    // Ledger has DEBIT of 100000 and CREDIT_REPAYMENT of 40000
    vi.mocked(db.khataReceivableEntry.findMany).mockResolvedValue([
      {
        id: "rec-1",
        saleId: "sale-ledger",
        customerId: "cust-2",
        entryType: "DEBIT_CREDIT_SALE",
        amountMinor: 100000,
        createdAt: new Date("2026-10-01T10:00:00.000Z"),
      } as any,
      {
        id: "rec-2",
        saleId: "sale-ledger",
        customerId: "cust-2",
        entryType: "CREDIT_REPAYMENT",
        amountMinor: 40000,
        createdAt: new Date("2026-10-05T10:00:00.000Z"),
      } as any,
    ]);

    // Payment allocation also exists for 40000 (which corresponds to rec-2)
    vi.mocked(db.khataPaymentAllocation.findMany).mockResolvedValue([
      {
        id: "kpa-ledger",
        saleId: "sale-ledger",
        khataPaymentId: "pay-ledger",
        amountMinor: 40000,
      } as any,
    ]);
    vi.mocked(db.khataPayment.findMany).mockResolvedValue([
      {
        id: "pay-ledger",
        customerId: "cust-2",
        actorUserId: "user-1",
        amountMinor: 40000,
        paymentMethod: "UPI",
        createdAt: new Date("2026-10-05T10:00:00.000Z"),
      } as any,
    ]);

    vi.mocked(db.khataAdvanceAllocation.findMany).mockResolvedValue([]);
    vi.mocked(db.saleReturn.findMany).mockResolvedValue([]);
    vi.mocked(db.company.findUnique).mockResolvedValue(null);
    vi.mocked(db.customer.findMany).mockResolvedValue([
      {
        id: "cust-2",
        name: "Priya Patel",
        phone: "+919876543211",
        customerType: "REGULAR",
        creditLimitMinor: 100000,
        paymentTermsDays: 14,
      } as any,
    ]);
    vi.mocked(db.user.findMany).mockResolvedValue([]);

    const book = await getKhataBook({ tenantId, companyId, currency, now: fixedNow });

    // Since ledger entries exist, authoritative ledger is used (100000 - 40000 = 60000).
    // The payment allocation is NOT subtracted again!
    expect(book.totalDueMinor).toBe(60000);
    expect(book.customers[0]?.dueMinor).toBe(60000);
  });

  it("criterion 5: unmapped legacy records (null companyId or null currency) are not queried", async () => {
    // Ensure findMany queries strictly assert companyId and currencySnapshot
    await getKhataBook({ tenantId, companyId: "comp-target", currency: "INR", now: fixedNow });

    const saleCall = vi.mocked(db.sale.findMany).mock.calls[0]?.[0];
    expect(saleCall?.where?.companyId).toBe("comp-target");
    expect(saleCall?.where?.currencySnapshot).toBe("INR");

    const paymentCall = vi.mocked(db.khataPayment.findMany).mock.calls[0]?.[0];
    expect(paymentCall?.where?.companyId).toBe("comp-target");
    expect(paymentCall?.where?.currency).toBe("INR");
  });

  it("criterion 6: missing terms leave dueDate as null and status as ON_TRACK without inventing 30 days", async () => {
    vi.mocked(db.sale.findMany).mockResolvedValue([
      {
        id: "sale-noterms",
        billNumber: "INV-NOTERMS",
        customerId: "cust-noterms",
        totalMinor: 50000,
        paidMinor: 0,
        initialOnAccountMinor: 50000,
        completedAt: new Date("2026-09-01T10:00:00.000Z"),
        dueDateSnapshot: null,
        effectiveTermsDaysSnapshot: null,
      } as any,
    ]);

    vi.mocked(db.khataReceivableEntry.findMany).mockResolvedValue([]);
    vi.mocked(db.khataPaymentAllocation.findMany).mockResolvedValue([]);
    vi.mocked(db.khataAdvanceAllocation.findMany).mockResolvedValue([]);
    vi.mocked(db.saleReturn.findMany).mockResolvedValue([]);
    vi.mocked(db.khataPayment.findMany).mockResolvedValue([]);
    // Company has NO default terms
    vi.mocked(db.company.findUnique).mockResolvedValue(null);
    // Customer has NO terms
    vi.mocked(db.customer.findMany).mockResolvedValue([
      {
        id: "cust-noterms",
        name: "No Terms Customer",
        phone: "+919876543299",
        customerType: "REGULAR",
        creditLimitMinor: null,
        paymentTermsDays: null,
      } as any,
    ]);
    vi.mocked(db.user.findMany).mockResolvedValue([]);

    const book = await getKhataBook({ tenantId, companyId, currency, now: fixedNow });

    expect(book.customers[0]?.dueDate).toBeNull();
    expect(book.customers[0]?.status).toBe("ON_TRACK");
  });

  /** Empty scoped data plus one known customer; individual tests override what they need. */
  function mockBase() {
    vi.mocked(db.sale.findMany).mockResolvedValue([]);
    vi.mocked(db.khataReceivableEntry.findMany).mockResolvedValue([]);
    vi.mocked(db.khataPaymentAllocation.findMany).mockResolvedValue([]);
    vi.mocked(db.khataAdvanceAllocation.findMany).mockResolvedValue([]);
    vi.mocked(db.saleReturn.findMany).mockResolvedValue([]);
    vi.mocked(db.khataPayment.findMany).mockResolvedValue([]);
    vi.mocked(db.company.findUnique).mockResolvedValue(null);
    vi.mocked(db.customer.findMany).mockResolvedValue([
      { id: "cust-1", name: "Rahul Sharma", phone: null, customerType: "REGULAR", creditLimitMinor: null, paymentTermsDays: 15 } as any,
    ]);
    vi.mocked(db.user.findMany).mockResolvedValue([]);
  }

  const sale80k = {
    id: "sale-1",
    billNumber: "INV-001",
    customerId: "cust-1",
    totalMinor: 100000,
    paidMinor: 20000,
    initialOnAccountMinor: 80000,
    completedAt: new Date("2026-10-10T10:00:00.000Z"),
    dueDateSnapshot: new Date("2026-10-25T10:00:00.000Z"),
    effectiveTermsDaysSnapshot: 15,
  } as any;

  function expectNoQueries() {
    for (const model of Object.values(db) as unknown as Record<string, ReturnType<typeof vi.fn>>[]) {
      for (const fn of Object.values(model)) expect(fn).not.toHaveBeenCalled();
    }
  }

  describe("scope is mandatory", () => {
    it.each([
      ["missing companyId", { companyId: undefined, currency }],
      ["blank companyId", { companyId: "  ", currency }],
      ["missing currency", { companyId, currency: undefined }],
      ["blank currency", { companyId, currency: "" }],
    ])("rejects %s before any database query", async (_label, scope) => {
      await expect(getKhataBook({ tenantId, ...(scope as any), now: fixedNow })).rejects.toBeInstanceOf(KhataScopeError);
      expectNoQueries();
    });

    it("rejects a blank tenant before any database query", async () => {
      await expect(getKhataBook({ tenantId: "", companyId, currency, now: fixedNow })).rejects.toBeInstanceOf(KhataScopeError);
      expectNoQueries();
    });

    it("scopes every sale, ledger, allocation, return and payment query by tenant, company and currency", async () => {
      mockBase();
      await getKhataBook({ tenantId, companyId, currency, now: fixedNow });
      const scoped = { tenantId, companyId, currency };
      expect(vi.mocked(db.sale.findMany).mock.calls[0]?.[0]?.where).toMatchObject({ tenantId, companyId, currencySnapshot: currency });
      expect(vi.mocked(db.khataReceivableEntry.findMany).mock.calls[0]?.[0]?.where).toMatchObject(scoped);
      expect(vi.mocked(db.khataPaymentAllocation.findMany).mock.calls[0]?.[0]?.where).toMatchObject(scoped);
      expect(vi.mocked(db.khataAdvanceAllocation.findMany).mock.calls[0]?.[0]?.where).toMatchObject(scoped);
      expect(vi.mocked(db.khataPayment.findMany).mock.calls[0]?.[0]?.where).toMatchObject(scoped);
      expect(vi.mocked(db.saleReturn.findMany).mock.calls[0]?.[0]?.where).toMatchObject({
        tenantId,
        originalSale: { companyId, currencySnapshot: currency },
      });
      expect(vi.mocked(db.company.findUnique).mock.calls[0]?.[0]?.where).toEqual({ id_tenantId: { id: companyId, tenantId } });
    });

    it("keeps each legal company's book separate", async () => {
      mockBase();
      vi.mocked(db.sale.findMany).mockImplementation((async (args: any) =>
        args.where.companyId === "comp-1" ? [sale80k] : [{ ...sale80k, id: "sale-2", initialOnAccountMinor: 15000 }]) as any);
      const one = await getKhataBook({ tenantId, companyId: "comp-1", currency, now: fixedNow });
      const two = await getKhataBook({ tenantId, companyId: "comp-2", currency, now: fixedNow });
      expect(one.totalDueMinor).toBe(80000);
      expect(two.totalDueMinor).toBe(15000);
    });
  });

  describe("inconsistent balances fail closed", () => {
    it("reports ledger credits above debits instead of a zero due", async () => {
      mockBase();
      vi.mocked(db.sale.findMany).mockResolvedValue([sale80k]);
      vi.mocked(db.khataReceivableEntry.findMany).mockResolvedValue([
        { id: "r1", saleId: "sale-1", customerId: "cust-1", entryType: "DEBIT_CREDIT_SALE", amountMinor: 80000, createdAt: fixedNow },
        { id: "r2", saleId: "sale-1", customerId: "cust-1", entryType: "CREDIT_REPAYMENT", amountMinor: 90000, createdAt: fixedNow },
      ] as any);
      const err = await getKhataBook({ tenantId, companyId, currency, now: fixedNow }).catch((e) => e);
      expect(err).toBeInstanceOf(KhataInconsistentError);
      expect(err.issues).toEqual([{ saleId: "sale-1", paymentId: null, reason: "NEGATIVE_LEDGER_BALANCE" }]);
    });

    it.each([
      ["payment allocations", "pay"],
      ["advance allocations", "adv"],
      ["completed refunds", "ret"],
    ])("reports %s above the sale's on-account amount", async (_label, kind) => {
      mockBase();
      vi.mocked(db.sale.findMany).mockResolvedValue([sale80k]);
      if (kind === "pay") {
        vi.mocked(db.khataPaymentAllocation.findMany).mockResolvedValue([
          { id: "a1", saleId: "sale-1", khataPaymentId: "pay-1", amountMinor: 80001 },
        ] as any);
        vi.mocked(db.khataPayment.findMany).mockResolvedValue([
          { id: "pay-1", customerId: "cust-1", actorUserId: "u", amountMinor: 90000, paymentMethod: "CASH", createdAt: fixedNow },
        ] as any);
      } else if (kind === "adv") {
        vi.mocked(db.khataAdvanceAllocation.findMany).mockResolvedValue([{ id: "a1", saleId: "sale-1", amountMinor: 80001 }] as any);
      } else {
        vi.mocked(db.saleReturn.findMany).mockResolvedValue([{ id: "r1", originalSaleId: "sale-1", totalRefundMinor: 80001 }] as any);
      }
      const err = await getKhataBook({ tenantId, companyId, currency, now: fixedNow }).catch((e) => e);
      expect(err).toBeInstanceOf(KhataInconsistentError);
      expect(err.issues).toContainEqual({ saleId: "sale-1", paymentId: null, reason: "OVER_ALLOCATED_SALE" });
    });

    it("reports combined payment, advance and refund credits above the on-account amount", async () => {
      mockBase();
      vi.mocked(db.sale.findMany).mockResolvedValue([sale80k]);
      vi.mocked(db.khataAdvanceAllocation.findMany).mockResolvedValue([{ id: "a1", saleId: "sale-1", amountMinor: 50000 }] as any);
      vi.mocked(db.saleReturn.findMany).mockResolvedValue([{ id: "r1", originalSaleId: "sale-1", totalRefundMinor: 30001 }] as any);
      await expect(getKhataBook({ tenantId, companyId, currency, now: fixedNow })).rejects.toBeInstanceOf(KhataInconsistentError);
    });

    it("reports a payment allocated beyond its own amount", async () => {
      mockBase();
      vi.mocked(db.sale.findMany).mockResolvedValue([sale80k]);
      vi.mocked(db.khataPaymentAllocation.findMany).mockResolvedValue([
        { id: "a1", saleId: "sale-1", khataPaymentId: "pay-1", amountMinor: 30000 },
      ] as any);
      vi.mocked(db.khataPayment.findMany).mockResolvedValue([
        { id: "pay-1", customerId: "cust-1", actorUserId: "u", amountMinor: 20000, paymentMethod: "CASH", createdAt: fixedNow },
      ] as any);
      const err = await getKhataBook({ tenantId, companyId, currency, now: fixedNow }).catch((e) => e);
      expect(err).toBeInstanceOf(KhataInconsistentError);
      expect(err.issues).toEqual([{ saleId: null, paymentId: "pay-1", reason: "OVER_ALLOCATED_PAYMENT" }]);
    });

    it("keeps an exactly settled sale as a valid zero, not an error", async () => {
      mockBase();
      vi.mocked(db.sale.findMany).mockResolvedValue([sale80k]);
      vi.mocked(db.khataAdvanceAllocation.findMany).mockResolvedValue([{ id: "a1", saleId: "sale-1", amountMinor: 50000 }] as any);
      vi.mocked(db.saleReturn.findMany).mockResolvedValue([{ id: "r1", originalSaleId: "sale-1", totalRefundMinor: 30000 }] as any);
      const book = await getKhataBook({ tenantId, companyId, currency, now: fixedNow });
      expect(book.totalDueMinor).toBe(0);
      expect(book.customers).toEqual([]);
    });

    it("keeps a ledger that nets to zero as a valid zero", async () => {
      mockBase();
      vi.mocked(db.sale.findMany).mockResolvedValue([sale80k]);
      vi.mocked(db.khataReceivableEntry.findMany).mockResolvedValue([
        { id: "r1", saleId: "sale-1", customerId: "cust-1", entryType: "DEBIT_CREDIT_SALE", amountMinor: 80000, createdAt: fixedNow },
        { id: "r2", saleId: "sale-1", customerId: "cust-1", entryType: "CREDIT_SALE_RETURN", amountMinor: 80000, createdAt: fixedNow },
      ] as any);
      const book = await getKhataBook({ tenantId, companyId, currency, now: fixedNow });
      expect(book.totalDueMinor).toBe(0);
    });

    it("partial payment keeps integer minor-unit arithmetic", async () => {
      mockBase();
      vi.mocked(db.sale.findMany).mockResolvedValue([{ ...sale80k, initialOnAccountMinor: 80001 }]);
      vi.mocked(db.khataPaymentAllocation.findMany).mockResolvedValue([
        { id: "a1", saleId: "sale-1", khataPaymentId: "pay-1", amountMinor: 33333 },
      ] as any);
      vi.mocked(db.khataPayment.findMany).mockResolvedValue([
        { id: "pay-1", customerId: "cust-1", actorUserId: "u", amountMinor: 33333, paymentMethod: "UPI", createdAt: fixedNow },
      ] as any);
      const book = await getKhataBook({ tenantId, companyId, currency, now: fixedNow });
      expect(book.totalDueMinor).toBe(46668);
      expect(Number.isInteger(book.totalDueMinor)).toBe(true);
    });
  });

  describe("no mutation is enabled on the khata screen", () => {
    const root = join(__dirname, "..", "app", "(app)", "khata");
    const page = readFileSync(join(root, "page.tsx"), "utf8");
    const client = readFileSync(join(root, "KhataBookClient.tsx"), "utf8");

    it("renders every quick action as a disabled button", () => {
      expect(page).toMatch(/<button\s+type="button"\s+disabled/);
      expect(page).not.toMatch(/onClick|"use server"|fetch\(/);
    });

    it("collects only through the audited repayment API, once per attempt", () => {
      // Collection was enabled once the repayment API shipped (owner Q6/Q7, 2026-10-14). The only
      // write this screen makes is that API, under one idempotency key per attempt.
      expect(client).toMatch(/setCollecting\(c\)/);
      expect(client).not.toMatch(/Payment collection is disabled/);
      const writes = client.match(/fetch\("[^"]+"/g) ?? [];
      expect(writes).toEqual(['fetch("/api/v1/khata/payments"']);
      expect(client).toMatch(/idempotencyKey: key\.current/);
    });
  });
});
