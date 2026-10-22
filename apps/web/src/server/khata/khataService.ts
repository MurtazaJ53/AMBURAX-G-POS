import { db } from "@/server/db";
import { requireCompany } from "@/server/erp/documentSync";
import { ErpClient } from "@/server/erp/client";
import { resolveErpEnvironment, EnvErpCredentialProvider } from "@/server/erp/config";
import type { ErpEnvironment } from "@/server/erp/config";
import { HttpErpTransport } from "@/server/erp/httpTransport";
import { ErpError } from "@/server/erp/errors";
import type { ErpTransport } from "@/server/erp/transport";
import { STORE_SCOPE_SELECT, storeScopeOf } from "@/server/sales/storeScope";

/** A khata payment was attempted without an explicitly mapped Store company/currency. */
export class KhataPaymentScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KhataPaymentScopeError";
  }
}

/**
 * Khata payment collection is disabled until payment allocation is implemented and approved.
 * Recording an unallocated payment would lower displayed dues and post an ERP Payment Entry.
 */
export class KhataPaymentsUnavailableError extends Error {
  constructor() {
    super("Khata payment collection is not available until payment allocation is approved.");
    this.name = "KhataPaymentsUnavailableError";
  }
}

/** Fail-closed gate, checked before any read or write. */
function assertKhataPaymentsEnabled(): void {
  throw new KhataPaymentsUnavailableError();
}

export interface OutstandingInvoice {
  name: string;
  customer: string;
  outstandingAmount: number;
  grandTotal: number;
  postingDate: string;
  dueDate: string;
  status: "Draft" | "Return" | "Credit Note Issued" | "Submitted" | "Paid" | "Partly Paid" | "Unpaid" | "Overdue" | "Cancelled" | string;
  daysPending: number;
}

export interface CustomerDueSummary {
  customerId: string;
  customerName: string;
  phone: string | null;
  erpCustomerName: string | null;
  totalDueMinor: number;
  overdueMinor: number;
  daysPending: number;
  invoicesCount: number;
  invoices: OutstandingInvoice[];
}

export interface KhataOverview {
  totalCustomers: number;
  totalDueAmountMinor: number;
  activeKhataCount: number;
  overdueCustomersCount: number;
  avgDaysPending: number;
  customersWithDue: CustomerDueSummary[];
  ageing: {
    "0 - 7 Days": number;
    "8 - 15 Days": number;
    "16 - 30 Days": number;
    "31 - 60 Days": number;
    "> 60 Days": number;
  };
}

export class ErpKhataService {
  private client: ErpClient;

  constructor(private transport?: ErpTransport) {
    this.client = new ErpClient(
      transport ?? new HttpErpTransport(),
      new EnvErpCredentialProvider(),
      {}
    );
  }

  /**
   * Helper to resolve ERPNext customer name for an AMBURAX customer CUID (`customer_pos_id`).
   */
  public async resolveErpCustomerName(
    env: ErpEnvironment,
    tenantId: string,
    customerId: string,
    correlationId: string
  ): Promise<string | null> {
    const filters = JSON.stringify([["customer_pos_id", "=", customerId]]);
    const fields = JSON.stringify(["name"]);
    const path = `/api/resource/Customer?filters=${encodeURIComponent(filters)}&fields=${encodeURIComponent(fields)}`;

    try {
      const response = await this.client.call(
        env,
        { tenantId, correlationId, causationId: customerId },
        { method: "GET", path }
      );
      const body = response.body as { data?: Array<{ name: string }> };
      if (Array.isArray(body?.data) && body.data.length > 0 && body.data[0]?.name) {
        return body.data[0].name;
      }
      return null;
    } catch (err) {
      if (err instanceof ErpError && err.kind === "not_found") {
        return null;
      }
      throw err;
    }
  }

  /**
   * Fetch outstanding receivable invoices for a given customer from ERPNext.
   */
  public async getCustomerReceivables(params: {
    tenantId: string;
    customerId: string;
    correlationId?: string;
  }): Promise<CustomerDueSummary> {
    const correlationId = params.correlationId ?? "khata-receivables-lookup";

    const customer = await db.customer.findUnique({
      where: { id: params.customerId, tenantId: params.tenantId },
      select: { id: true, name: true, phone: true },
    });
    if (!customer) {
      throw new Error(`Customer ${params.customerId} not found for tenant ${params.tenantId}`);
    }

    const envResult = await resolveErpEnvironment(params.tenantId);
    if (envResult.status !== "ok") {
      return {
        customerId: customer.id,
        customerName: customer.name,
        phone: customer.phone,
        erpCustomerName: null,
        totalDueMinor: 0,
        overdueMinor: 0,
        daysPending: 0,
        invoicesCount: 0,
        invoices: [],
      };
    }

    const erpCustomerName = await this.resolveErpCustomerName(
      envResult.environment,
      params.tenantId,
      params.customerId,
      correlationId
    );

    if (!erpCustomerName) {
      return {
        customerId: customer.id,
        customerName: customer.name,
        phone: customer.phone,
        erpCustomerName: null,
        totalDueMinor: 0,
        overdueMinor: 0,
        daysPending: 0,
        invoicesCount: 0,
        invoices: [],
      };
    }

    // Query submitted Sales Invoices with outstanding_amount > 0
    const filters = JSON.stringify([
      ["customer", "=", erpCustomerName],
      ["outstanding_amount", ">", 0],
      ["docstatus", "=", 1],
    ]);
    const fields = JSON.stringify([
      "name",
      "customer",
      "outstanding_amount",
      "grand_total",
      "posting_date",
      "due_date",
      "status",
    ]);
    const path = `/api/resource/Sales Invoice?filters=${encodeURIComponent(filters)}&fields=${encodeURIComponent(fields)}&limit_page_length=100`;

    const response = await this.client.call(
      envResult.environment,
      { tenantId: params.tenantId, correlationId, causationId: params.customerId },
      { method: "GET", path }
    );

    const body = response.body as {
      data?: Array<{
        name: string;
        customer: string;
        outstanding_amount: number;
        grand_total: number;
        posting_date: string;
        due_date: string;
        status: string;
      }>;
    };

    const rawInvoices = Array.isArray(body?.data) ? body.data : [];
    const today = new Date().toISOString().split("T")[0]!;
    const now = Date.now();

    let totalDueMinor = 0;
    let overdueMinor = 0;
    let maxDaysPending = 0;

    const invoices: OutstandingInvoice[] = rawInvoices.map((inv) => {
      const outstanding = Number(inv.outstanding_amount || 0);
      const grandTotal = Number(inv.grand_total || 0);
      const outMinor = Math.round(outstanding * 100);
      totalDueMinor += outMinor;

      const isOverdue = inv.status === "Overdue" || (inv.due_date && inv.due_date < today);
      if (isOverdue) {
        overdueMinor += outMinor;
      }

      const postTime = inv.posting_date ? new Date(inv.posting_date).getTime() : now;
      const daysPending = Math.max(0, Math.floor((now - postTime) / (1000 * 60 * 60 * 24)));
      if (daysPending > maxDaysPending) {
        maxDaysPending = daysPending;
      }

      return {
        name: inv.name,
        customer: inv.customer,
        outstandingAmount: outstanding,
        grandTotal,
        postingDate: inv.posting_date,
        dueDate: inv.due_date,
        status: inv.status,
        daysPending,
      };
    });

    return {
      customerId: customer.id,
      customerName: customer.name,
      phone: customer.phone,
      erpCustomerName,
      totalDueMinor,
      overdueMinor,
      daysPending: maxDaysPending,
      invoicesCount: invoices.length,
      invoices,
    };
  }

  /**
   * Fetch entire Khata Overview for tenant:
   * Aggregates live ERPNext receivables across all customers.
   */
  public async getKhataOverview(params: {
    tenantId: string;
    correlationId?: string;
  }): Promise<KhataOverview> {
    const correlationId = params.correlationId ?? "khata-overview-lookup";

    const [totalCustomers, customers] = await Promise.all([
      db.customer.count({ where: { tenantId: params.tenantId, isActive: true } }),
      db.customer.findMany({
        where: { tenantId: params.tenantId, isActive: true },
        select: { id: true, name: true, phone: true },
        orderBy: { name: "asc" },
      }),
    ]);

    const envResult = await resolveErpEnvironment(params.tenantId);
    if (envResult.status !== "ok") {
      return {
        totalCustomers,
        totalDueAmountMinor: 0,
        activeKhataCount: 0,
        overdueCustomersCount: 0,
        avgDaysPending: 0,
        customersWithDue: [],
        ageing: {
          "0 - 7 Days": 0,
          "8 - 15 Days": 0,
          "16 - 30 Days": 0,
          "31 - 60 Days": 0,
          "> 60 Days": 0,
        },
      };
    }

    // Query all outstanding Sales Invoices for this company in ERPNext
    const company = requireCompany(envResult.environment, correlationId);
    const filters = JSON.stringify([
      ["company", "=", company],
      ["outstanding_amount", ">", 0],
      ["docstatus", "=", 1],
    ]);
    const fields = JSON.stringify([
      "name",
      "customer",
      "outstanding_amount",
      "grand_total",
      "posting_date",
      "due_date",
      "status",
    ]);
    const path = `/api/resource/Sales Invoice?filters=${encodeURIComponent(filters)}&fields=${encodeURIComponent(fields)}&limit_page_length=500`;

    const response = await this.client.call(
      envResult.environment,
      { tenantId: params.tenantId, correlationId },
      { method: "GET", path }
    );

    const body = response.body as {
      data?: Array<{
        name: string;
        customer: string;
        outstanding_amount: number;
        grand_total: number;
        posting_date: string;
        due_date: string;
        status: string;
      }>;
    };

    const rawInvoices = Array.isArray(body?.data) ? body.data : [];

    // Also get ERP Customer mapping (customer_pos_id -> name)
    const custFilter = JSON.stringify([["customer_pos_id", "is", "set"]]);
    const custFields = JSON.stringify(["name", "customer_pos_id"]);
    const custPath = `/api/resource/Customer?filters=${encodeURIComponent(custFilter)}&fields=${encodeURIComponent(custFields)}&limit_page_length=500`;

    let erpToAmburax = new Map<string, string>();
    try {
      const custRes = await this.client.call(
        envResult.environment,
        { tenantId: params.tenantId, correlationId },
        { method: "GET", path: custPath }
      );
      const custBody = custRes.body as { data?: Array<{ name: string; customer_pos_id: string }> };
      if (Array.isArray(custBody?.data)) {
        for (const c of custBody.data) {
          if (c.name && c.customer_pos_id) {
            erpToAmburax.set(c.name, c.customer_pos_id);
          }
        }
      }
    } catch {
      // Ignore if cannot list customers
    }

    const amburaxCustById = new Map(customers.map((c) => [c.id, c]));

    const today = new Date().toISOString().split("T")[0]!;
    const now = Date.now();

    const ageing = {
      "0 - 7 Days": 0,
      "8 - 15 Days": 0,
      "16 - 30 Days": 0,
      "31 - 60 Days": 0,
      "> 60 Days": 0,
    };

    // Group invoices by AMBURAX customer
    const grouped = new Map<string, { erpCustomerName: string; invoices: OutstandingInvoice[] }>();

    for (const inv of rawInvoices) {
      const outstanding = Number(inv.outstanding_amount || 0);
      const grandTotal = Number(inv.grand_total || 0);
      const postTime = inv.posting_date ? new Date(inv.posting_date).getTime() : now;
      const daysPending = Math.max(0, Math.floor((now - postTime) / (1000 * 60 * 60 * 24)));

      const outInvoice: OutstandingInvoice = {
        name: inv.name,
        customer: inv.customer,
        outstandingAmount: outstanding,
        grandTotal,
        postingDate: inv.posting_date,
        dueDate: inv.due_date,
        status: inv.status,
        daysPending,
      };

      // Ageing bucket
      if (daysPending <= 7) ageing["0 - 7 Days"] += outstanding;
      else if (daysPending <= 15) ageing["8 - 15 Days"] += outstanding;
      else if (daysPending <= 30) ageing["16 - 30 Days"] += outstanding;
      else if (daysPending <= 60) ageing["31 - 60 Days"] += outstanding;
      else ageing["> 60 Days"] += outstanding;

      const amburaxId = erpToAmburax.get(inv.customer);
      if (amburaxId) {
        if (!grouped.has(amburaxId)) {
          grouped.set(amburaxId, { erpCustomerName: inv.customer, invoices: [] });
        }
        grouped.get(amburaxId)!.invoices.push(outInvoice);
      }
    }

    let totalDueAmountMinor = 0;
    let overdueCustomersCount = 0;
    let totalDaysPendingSum = 0;
    const customersWithDue: CustomerDueSummary[] = [];

    for (const [amburaxId, group] of grouped.entries()) {
      const cust = amburaxCustById.get(amburaxId);
      if (!cust) continue;

      let custDueMinor = 0;
      let custOverdueMinor = 0;
      let custMaxDays = 0;

      for (const inv of group.invoices) {
        const outMinor = Math.round(inv.outstandingAmount * 100);
        custDueMinor += outMinor;
        const isOverdue = inv.status === "Overdue" || (inv.dueDate && inv.dueDate < today);
        if (isOverdue) custOverdueMinor += outMinor;
        if (inv.daysPending > custMaxDays) custMaxDays = inv.daysPending;
      }

      totalDueAmountMinor += custDueMinor;
      if (custOverdueMinor > 0) overdueCustomersCount++;
      totalDaysPendingSum += custMaxDays;

      customersWithDue.push({
        customerId: cust.id,
        customerName: cust.name,
        phone: cust.phone,
        erpCustomerName: group.erpCustomerName,
        totalDueMinor: custDueMinor,
        overdueMinor: custOverdueMinor,
        daysPending: custMaxDays,
        invoicesCount: group.invoices.length,
        invoices: group.invoices,
      });
    }

    // Sort highest due first
    customersWithDue.sort((a, b) => b.totalDueMinor - a.totalDueMinor);

    const activeKhataCount = customersWithDue.length;
    const avgDaysPending = activeKhataCount > 0 ? Math.round(totalDaysPendingSum / activeKhataCount) : 0;

    return {
      totalCustomers,
      totalDueAmountMinor,
      activeKhataCount,
      overdueCustomersCount,
      avgDaysPending,
      customersWithDue,
      ageing,
    };
  }

  /**
   * Record a customer payment collection in AMBURAX and enqueue an outbox event.
   * Atomically inside a Prisma transaction:
   * 1. Check idempotency.
   * 2. Insert KhataPayment.
   * 3. Insert OutboxEvent (CustomerPaymentCollected).
   */
  public async collectCustomerPayment(params: {
    tenantId: string;
    customerId: string;
    actorUserId: string;
    /** The authorized session Store; its persisted Company/currency scope the payment. */
    storeId: string;
    amountMinor: number;
    paymentMethod?: "CASH" | "UPI" | "CARD";
    reference?: string | null;
    notes?: string | null;
    idempotencyKey: string;
    correlationId?: string;
  }) {
    // Disabled at the service boundary so no caller can bypass the route: nothing below runs.
    assertKhataPaymentsEnabled();

    const correlationId = params.correlationId ?? `corr-khata-pay-${Date.now()}`;

    if (params.amountMinor <= 0) {
      throw new Error("Payment amount must be greater than zero");
    }

    const customer = await db.customer.findUnique({
      where: { id: params.customerId, tenantId: params.tenantId },
    });
    if (!customer) {
      throw new Error(`Customer ${params.customerId} not found for tenant ${params.tenantId}`);
    }

    // Scope comes only from the persisted Store, never the request. Without an explicit
    // company/currency mapping nothing is written: no unscoped payment, no outbox event.
    if (!params.storeId?.trim()) throw new KhataPaymentScopeError("A store is required to collect a khata payment");
    const store = await db.store.findFirst({
      where: { id: params.storeId, tenantId: params.tenantId },
      select: STORE_SCOPE_SELECT,
    });
    if (!store) throw new Error(`Store ${params.storeId} not found for tenant ${params.tenantId}`);
    const scope = storeScopeOf(store);
    if (!scope) {
      throw new KhataPaymentScopeError(`Store ${params.storeId} is not mapped to a legal company and currency`);
    }

    // Fast-path idempotency check
    const existing = await db.khataPayment.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existing) {
      return {
        payment: existing,
        duplicate: true,
      };
    }

    const paymentMethod = params.paymentMethod ?? "CASH";

    const payment = await db.$transaction(async (tx) => {
      const created = await tx.khataPayment.create({
        data: {
          tenantId: params.tenantId,
          customerId: params.customerId,
          actorUserId: params.actorUserId,
          amountMinor: params.amountMinor,
          paymentMethod,
          reference: params.reference ?? null,
          notes: params.notes ?? null,
          idempotencyKey: params.idempotencyKey,
          companyId: scope.companyId,
          currency: scope.currency,
        },
      });

      const { enqueueOutboxEvent } = await import("@/server/events/outbox");
      await enqueueOutboxEvent(tx, {
        tenantId: params.tenantId,
        eventType: "CustomerPaymentCollected",
        actorUserId: params.actorUserId,
        correlationId,
        entityId: created.id,
        payload: {
          paymentId: created.id,
          customerId: params.customerId,
          amountMinor: params.amountMinor,
          paymentMethod,
          reference: params.reference ?? null,
        },
      });

      return created;
    });

    return {
      payment,
      duplicate: false,
    };
  }
}

