import { db } from "@/server/db";
import { calculateInvoiceDueDate } from "./dueDate";

/**
 * The khata (udhar) book, scoped strictly to a legal Company and currency.
 *
 * Balance determination:
 * 1. For completed sales belonging to (tenantId, companyId, currency):
 *    - If posted to receivable ledger (`khata_receivable_entries`):
 *      `saleBalance = sum(DEBIT entries) - sum(CREDIT entries)`.
 *    - If not posted to ledger:
 *      `saleBalance = initialCredit - allocatedPaymentCredits - allocatedAdvanceCredits - completedReturnRefunds`.
 * 2. For payments (`khata_payments`) belonging to (tenantId, companyId, currency):
 *    - Allocated amounts already reduced specific sales.
 *    - Unallocated payment amounts (`amountMinor - sum(allocations)`) are applied FIFO
 *      to any remaining open sales for that customer.
 *
 * Neither sales, payments, allocations, returns, nor ledger entries are double-counted.
 * Unmapped legacy rows (where companyId or currency is NULL) are strictly excluded from
 * company-scoped customer dues.
 *
 * Fails closed: a missing scope throws `KhataScopeError` before any query, and a balance that
 * can only be explained by bad data (ledger credits above debits, allocations or refunds above
 * the sale's on-account amount, a payment allocated beyond its amount) throws
 * `KhataInconsistentError` instead of being clamped to zero.
 */

export type KhataStatus = "OVERDUE" | "DUE_SOON" | "ON_TRACK";

export interface KhataEntry {
  id: string;
  at: Date;
  kind: "UDHAR" | "PAYMENT";
  /** "Sale MAIN-000123" or "Payment (UPI)". */
  label: string;
  /** Positive for udhar given, negative for a payment collected. */
  amountMinor: number;
  /** What the customer owed right after this entry. */
  balanceMinor: number;
  saleId: string | null;
}

export interface KhataCustomer {
  id: string;
  name: string;
  phone: string | null;
  customerType: string;
  creditLimitMinor: number | null;
  dueMinor: number;
  /** Days since the oldest udhar that is still unpaid. */
  daysPending: number;
  /** When that oldest unpaid udhar falls due (its date + the customer's payment terms). Null if no terms set. */
  dueDate: Date | null;
  status: KhataStatus;
  lastUdharAt: Date;
  firstUdharAt: Date;
  /** Newest first, at most 25. */
  entries: KhataEntry[];
}

export interface KhataPaymentRow {
  id: string;
  at: Date;
  customerId: string;
  customerName: string;
  method: string;
  amountMinor: number;
  receivedBy: string | null;
}

export interface KhataBook {
  totalDueMinor: number;
  /** Customers who owe something right now. */
  activeKhata: number;
  overdueCustomers: number;
  avgDaysPending: number;
  collectedThisMonthMinor: number;
  ageing: { label: string; minor: number }[];
  /** Six calendar months, oldest first: udhar given and payments collected in each. */
  trend: { month: string; givenMinor: number; collectedMinor: number }[];
  customers: KhataCustomer[];
  recentPayments: KhataPaymentRow[];
}

export const DUE_SOON_WINDOW_DAYS = 7;
const DAY = 86_400_000;

export const AGEING_BANDS = ["0 - 7 Days", "8 - 15 Days", "16 - 30 Days", "31 - 60 Days", "> 60 Days"] as const;

function band(days: number): number {
  if (days <= 7) return 0;
  if (days <= 15) return 1;
  if (days <= 30) return 2;
  if (days <= 60) return 3;
  return 4;
}

const DEBIT_TYPES = new Set(["DEBIT_CREDIT_SALE", "DEBIT_REVERSAL"]);
const CREDIT_TYPES = new Set(["CREDIT_REPAYMENT", "CREDIT_SALE_RETURN", "CREDIT_ADVANCE_APPLY", "CREDIT_REVERSAL"]);

function ledgerTotals(entries: { entryType: string; amountMinor: number }[]): { debits: number; credits: number } {
  let debits = 0;
  let credits = 0;
  for (const e of entries) {
    if (DEBIT_TYPES.has(e.entryType)) debits += e.amountMinor;
    else if (CREDIT_TYPES.has(e.entryType)) credits += e.amountMinor;
  }
  return { debits, credits };
}

const METHOD_LABEL: Record<string, string> = { CASH: "Cash", UPI: "UPI", CARD: "Card" };

export interface GetKhataBookParams {
  tenantId: string;
  companyId: string;
  currency: string;
  now?: Date;
}

/** The book was asked for without a full (tenant, company, currency) scope. */
export class KhataScopeError extends Error {
  constructor(missing: string) {
    super(`Khata book requires ${missing}`);
    this.name = "KhataScopeError";
  }
}

export interface KhataInconsistency {
  saleId: string | null;
  paymentId: string | null;
  reason: "NEGATIVE_LEDGER_BALANCE" | "OVER_ALLOCATED_SALE" | "OVER_ALLOCATED_PAYMENT";
}

/** Stored balances cannot be reconciled; nothing is shown rather than a clamped figure. */
export class KhataInconsistentError extends Error {
  constructor(readonly issues: KhataInconsistency[]) {
    super(`Khata balances inconsistent (${issues.length} issue${issues.length === 1 ? "" : "s"})`);
    this.name = "KhataInconsistentError";
  }
}

function initialCreditOf(s: { initialOnAccountMinor: number; totalMinor: number; paidMinor: number }): number {
  return s.initialOnAccountMinor > 0 ? s.initialOnAccountMinor : Math.max(0, s.totalMinor - s.paidMinor);
}

export async function getKhataBook(params: GetKhataBookParams): Promise<KhataBook> {
  if (!params.tenantId?.trim()) throw new KhataScopeError("tenantId");
  if (!params.companyId?.trim()) throw new KhataScopeError("companyId");
  if (!params.currency?.trim()) throw new KhataScopeError("currency");
  const now = params.now ?? new Date();

  // 1. Completed sales scoped strictly to (tenantId, companyId, currency).
  // Legacy rows where companyId IS NULL or currencySnapshot IS NULL never match.
  const sales = await db.sale.findMany({
    where: {
      tenantId: params.tenantId,
      companyId: params.companyId,
      currencySnapshot: params.currency,
      status: "COMPLETED",
      customerId: { not: null },
    },
    select: {
      id: true,
      billNumber: true,
      customerId: true,
      totalMinor: true,
      paidMinor: true,
      initialOnAccountMinor: true,
      completedAt: true,
      dueDateSnapshot: true,
      effectiveTermsDaysSnapshot: true,
    },
    orderBy: [{ completedAt: "asc" }, { id: "asc" }],
  });

  const ledgerWhere = { tenantId: params.tenantId, companyId: params.companyId, currency: params.currency };

  // 2. Receivable ledger entries scoped to (tenantId, companyId, currency)
  const receivableEntries = await db.khataReceivableEntry.findMany({
    where: ledgerWhere,
    select: {
      id: true,
      saleId: true,
      customerId: true,
      entryType: true,
      amountMinor: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  // 3. Fetch fallback allocations & returns for sales without ledger entries
  const [paymentAllocations, advanceAllocations, saleReturns, payments, company] = await Promise.all([
    db.khataPaymentAllocation.findMany({
      where: ledgerWhere,
      select: {
        id: true,
        saleId: true,
        khataPaymentId: true,
        amountMinor: true,
      },
    }),
    db.khataAdvanceAllocation.findMany({
      where: ledgerWhere,
      select: {
        id: true,
        saleId: true,
        amountMinor: true,
      },
    }),
    db.saleReturn.findMany({
      // Returns carry no company/currency of their own; scope through the original sale.
      where: {
        tenantId: params.tenantId,
        status: "COMPLETED",
        originalSale: { companyId: params.companyId, currencySnapshot: params.currency },
      },
      select: {
        id: true,
        originalSaleId: true,
        totalRefundMinor: true,
      },
    }),
    // Payments scoped strictly to (tenantId, companyId, currency)
    db.khataPayment.findMany({
      where: ledgerWhere,
      select: {
        id: true,
        customerId: true,
        actorUserId: true,
        amountMinor: true,
        paymentMethod: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    db.company.findUnique({
      where: { id_tenantId: { id: params.companyId, tenantId: params.tenantId } },
      select: { defaultPaymentTermsDays: true },
    }),
  ]);

  // Index allocations and entries for fast deterministic lookup
  const receivableEntriesBySale = new Map<string, typeof receivableEntries>();
  for (const entry of receivableEntries) {
    if (entry.saleId) {
      const list = receivableEntriesBySale.get(entry.saleId) ?? [];
      list.push(entry);
      receivableEntriesBySale.set(entry.saleId, list);
    }
  }

  const paymentAllocationsBySale = new Map<string, number>();
  for (const pa of paymentAllocations) {
    paymentAllocationsBySale.set(pa.saleId, (paymentAllocationsBySale.get(pa.saleId) ?? 0) + pa.amountMinor);
  }

  const advanceAllocationsBySale = new Map<string, number>();
  for (const aa of advanceAllocations) {
    advanceAllocationsBySale.set(aa.saleId, (advanceAllocationsBySale.get(aa.saleId) ?? 0) + aa.amountMinor);
  }

  const returnsBySale = new Map<string, number>();
  for (const ret of saleReturns) {
    returnsBySale.set(ret.originalSaleId, (returnsBySale.get(ret.originalSaleId) ?? 0) + ret.totalRefundMinor);
  }

  const allocatedByPayment = new Map<string, number>();
  for (const pa of paymentAllocations) {
    allocatedByPayment.set(pa.khataPaymentId, (allocatedByPayment.get(pa.khataPaymentId) ?? 0) + pa.amountMinor);
  }

  // Fail closed on data that cannot be reconciled rather than clamping it to zero.
  const issues: KhataInconsistency[] = [];
  for (const s of sales) {
    const entries = receivableEntriesBySale.get(s.id);
    if (entries?.length) {
      const { debits, credits } = ledgerTotals(entries);
      if (credits > debits) issues.push({ saleId: s.id, paymentId: null, reason: "NEGATIVE_LEDGER_BALANCE" });
    }
    const applied =
      (paymentAllocationsBySale.get(s.id) ?? 0) + (advanceAllocationsBySale.get(s.id) ?? 0) + (returnsBySale.get(s.id) ?? 0);
    if (applied > initialCreditOf(s)) issues.push({ saleId: s.id, paymentId: null, reason: "OVER_ALLOCATED_SALE" });
  }
  for (const p of payments) {
    if ((allocatedByPayment.get(p.id) ?? 0) > p.amountMinor) {
      issues.push({ saleId: null, paymentId: p.id, reason: "OVER_ALLOCATED_PAYMENT" });
    }
  }
  if (issues.length) throw new KhataInconsistentError(issues);

  // Group sales by customer
  const salesByCustomer = new Map<string, typeof sales>();
  for (const s of sales) {
    if (!s.customerId) continue;
    const initialCredit = initialCreditOf(s);
    const hasLedger = receivableEntriesBySale.has(s.id);
    if (initialCredit > 0 || hasLedger) {
      const list = salesByCustomer.get(s.customerId) ?? [];
      list.push(s);
      salesByCustomer.set(s.customerId, list);
    }
  }

  const customerIds = [...new Set([...salesByCustomer.keys(), ...payments.map((p) => p.customerId)])];
  const actorIds = [...new Set(payments.map((p) => p.actorUserId))];

  const [customers, actors] = await Promise.all([
    customerIds.length
      ? db.customer.findMany({
          where: { tenantId: params.tenantId, id: { in: customerIds } },
          select: { id: true, name: true, phone: true, customerType: true, creditLimitMinor: true, paymentTermsDays: true },
        })
      : Promise.resolve([]),
    actorIds.length
      ? db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);

  const customerById = new Map(customers.map((c) => [c.id, c]));
  const actorName = new Map(actors.map((a) => [a.id, a.name]));

  const ageing = AGEING_BANDS.map((label) => ({ label, minor: 0 }));
  const book: KhataCustomer[] = [];

  for (const id of customerIds) {
    const c = customerById.get(id);
    if (!c) continue;

    const custSales = salesByCustomer.get(id) ?? [];
    const custPayments = payments.filter((p) => p.customerId === id);

    interface OpenSaleInfo {
      id: string;
      billNumber: string;
      completedAt: Date;
      initialCredit: number;
      remaining: number;
      dueDate: Date | null;
    }

    const openSales: OpenSaleInfo[] = [];

    for (const s of custSales) {
      const initialCredit = initialCreditOf(s);
      const entriesForSale = receivableEntriesBySale.get(s.id);

      let remaining = 0;
      if (entriesForSale && entriesForSale.length > 0) {
        const { debits, credits } = ledgerTotals(entriesForSale);
        remaining = debits - credits;
      } else {
        const allocatedPaid = paymentAllocationsBySale.get(s.id) ?? 0;
        const allocatedAdvance = advanceAllocationsBySale.get(s.id) ?? 0;
        const refunded = returnsBySale.get(s.id) ?? 0;
        remaining = initialCredit - allocatedPaid - allocatedAdvance - refunded;
      }

      // Determine authoritative due date without fabricating a default
      let dueDate: Date | null = null;
      if (s.dueDateSnapshot) {
        dueDate = s.dueDateSnapshot;
      } else if (s.effectiveTermsDaysSnapshot !== null && s.effectiveTermsDaysSnapshot !== undefined) {
        dueDate = calculateInvoiceDueDate({
          completedAt: s.completedAt,
          customerPaymentTermsDays: s.effectiveTermsDaysSnapshot,
          companyDefaultTermsDays: 0,
        }).dueDate;
      } else if (c.paymentTermsDays !== null && c.paymentTermsDays !== undefined) {
        dueDate = calculateInvoiceDueDate({
          completedAt: s.completedAt,
          customerPaymentTermsDays: c.paymentTermsDays,
          companyDefaultTermsDays: company?.defaultPaymentTermsDays ?? null,
        }).dueDate;
      } else if (
        company?.defaultPaymentTermsDays !== null &&
        company?.defaultPaymentTermsDays !== undefined &&
        company.defaultPaymentTermsDays > 0
      ) {
        dueDate = calculateInvoiceDueDate({
          completedAt: s.completedAt,
          customerPaymentTermsDays: null,
          companyDefaultTermsDays: company.defaultPaymentTermsDays,
        }).dueDate;
      }

      openSales.push({
        id: s.id,
        billNumber: s.billNumber,
        completedAt: s.completedAt,
        initialCredit,
        remaining,
        dueDate,
      });
    }

    // Determine unallocated payments for this customer
    let unallocatedPaymentTotal = 0;
    for (const p of custPayments) {
      const allocated = allocatedByPayment.get(p.id) ?? 0;
      // Over-allocation was rejected above, so this is never negative.
      unallocatedPaymentTotal += p.amountMinor - allocated;
    }

    // Apply unallocated payments FIFO across open sales (oldest completedAt first)
    let remainingUnallocated = unallocatedPaymentTotal;
    for (const sale of openSales) {
      if (sale.remaining <= 0) continue;
      const settled = Math.min(sale.remaining, remainingUnallocated);
      sale.remaining -= settled;
      remainingUnallocated -= settled;
    }

    const activeOpenSales = openSales.filter((s) => s.remaining > 0);
    const dueMinor = activeOpenSales.reduce((sum, s) => sum + s.remaining, 0);

    // If fully settled, customer does not have an active due
    if (dueMinor <= 0) continue;

    for (const sale of activeOpenSales) {
      const days = Math.max(0, Math.floor((now.getTime() - sale.completedAt.getTime()) / DAY));
      ageing[band(days)]!.minor += sale.remaining;
    }

    const oldestOpenSale = activeOpenSales[0]!;
    const daysPending = Math.max(0, Math.floor((now.getTime() - oldestOpenSale.completedAt.getTime()) / DAY));
    const dueDate = oldestOpenSale.dueDate;

    let status: KhataStatus = "ON_TRACK";
    if (dueDate) {
      const daysLeft = (dueDate.getTime() - now.getTime()) / DAY;
      status = daysLeft < 0 ? "OVERDUE" : daysLeft <= DUE_SOON_WINDOW_DAYS ? "DUE_SOON" : "ON_TRACK";
    }

    // Build chronological ledger entries
    const events = [
      ...custSales.map((s) => {
        const initialCredit = initialCreditOf(s);
        return {
          id: s.id,
          at: s.completedAt,
          kind: "UDHAR" as const,
          label: `Sale ${s.billNumber}`,
          amountMinor: initialCredit,
          saleId: s.id,
        };
      }),
      ...custPayments.map((p) => ({
        id: p.id,
        at: p.createdAt,
        kind: "PAYMENT" as const,
        label: `Payment (${METHOD_LABEL[p.paymentMethod] ?? p.paymentMethod})`,
        amountMinor: -p.amountMinor,
        saleId: null,
      })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());

    const entries: KhataEntry[] = events.reduce<KhataEntry[]>((list, e) => {
      const before = list.length ? list[list.length - 1]!.balanceMinor : 0;
      list.push({ ...e, balanceMinor: before + e.amountMinor });
      return list;
    }, []);

    const firstSale = custSales[0];
    const lastSale = custSales[custSales.length - 1];

    book.push({
      id: c.id,
      name: c.name,
      phone: c.phone,
      customerType: c.customerType,
      creditLimitMinor: c.creditLimitMinor,
      dueMinor,
      daysPending,
      dueDate,
      status,
      lastUdharAt: lastSale?.completedAt ?? now,
      firstUdharAt: firstSale?.completedAt ?? now,
      entries: [...entries].reverse().slice(0, 25),
    });
  }

  book.sort((a, b) => b.dueMinor - a.dueMinor);

  // Six calendar months, oldest first
  const trend: KhataBook["trend"] = [];
  for (let i = 5; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const inMonth = (d: Date) => d >= start && d < end;
    trend.push({
      month: start.toLocaleString("en-IN", { month: "short" }),
      givenMinor: sales
        .filter((s) => inMonth(s.completedAt))
        .reduce((s, u) => s + initialCreditOf(u), 0),
      collectedMinor: payments.filter((p) => inMonth(p.createdAt)).reduce((s, p) => s + p.amountMinor, 0),
    });
  }

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const totalDueMinor = book.reduce((s, c) => s + c.dueMinor, 0);

  return {
    totalDueMinor,
    activeKhata: book.length,
    overdueCustomers: book.filter((c) => c.status === "OVERDUE").length,
    avgDaysPending: book.length ? Math.round(book.reduce((s, c) => s + c.daysPending, 0) / book.length) : 0,
    collectedThisMonthMinor: payments.filter((p) => p.createdAt >= monthStart).reduce((s, p) => s + p.amountMinor, 0),
    ageing,
    trend,
    customers: book,
    recentPayments: payments
      .slice(-6)
      .reverse()
      .map((p) => ({
        id: p.id,
        at: p.createdAt,
        customerId: p.customerId,
        customerName: customerById.get(p.customerId)?.name ?? "Customer",
        method: METHOD_LABEL[p.paymentMethod] ?? p.paymentMethod,
        amountMinor: p.amountMinor,
        receivedBy: actorName.get(p.actorUserId) ?? null,
      })),
  };
}
