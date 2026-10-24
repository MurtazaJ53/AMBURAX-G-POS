import { db } from "@/server/db";
import { requireCompany, erpDate, erpTime } from "@/server/erp/documentSync";
import { ErpClient } from "@/server/erp/client";
import { resolveErpEnvironment, EnvErpCredentialProvider } from "@/server/erp/config";
import type { ErpEnvironment } from "@/server/erp/config";
import { HttpErpTransport } from "@/server/erp/httpTransport";
import { ErpError } from "@/server/erp/errors";
import type { ErpTransport } from "@/server/erp/transport";

/** AMBURAX payment method → the ERPNext Mode of Payment that provisioning creates for it. */
export const MODE_OF_PAYMENT = { CASH: "Cash", UPI: "UPI", CARD: "Credit Card" } as const;

export interface SyncPaymentResult {
  paymentEntryId: string;
  allocatedInvoices: string[];
  alreadySynced: boolean;
}

export class ErpPaymentAdapter {
  private client: ErpClient;

  constructor(private transport?: ErpTransport) {
    this.client = new ErpClient(
      transport ?? new HttpErpTransport(),
      new EnvErpCredentialProvider(),
      {}
    );
  }

  /**
   * Find existing Payment Entry in ERPNext by AMBURAX payment reference/remarks.
   */
  private async lookupPaymentEntry(
    env: ErpEnvironment,
    tenantId: string,
    remarksPrefix: string,
    correlationId: string
  ): Promise<string | null> {
    const filters = JSON.stringify([["remarks", "like", `%${remarksPrefix}%`]]);
    const fields = JSON.stringify(["name", "docstatus"]);
    const path = `/api/resource/Payment Entry?filters=${encodeURIComponent(filters)}&fields=${encodeURIComponent(fields)}`;

    try {
      const response = await this.client.call(
        env,
        { tenantId, correlationId },
        { method: "GET", path }
      );
      const body = response.body as { data?: Array<{ name: string; docstatus: number }> };
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

  /** The account linked to `mode` for `company`. Refuses rather than guessing when none is linked. */
  private async modeOfPaymentAccount(
    env: ErpEnvironment,
    tenantId: string,
    mode: string,
    company: string,
    correlationId: string,
    causationId: string
  ): Promise<string> {
    const res = await this.client.call(
      env,
      { tenantId, correlationId, causationId },
      { method: "GET", path: `/api/resource/Mode of Payment/${encodeURIComponent(mode)}` }
    );
    const accounts = (res.body as { data?: { accounts?: Array<{ company: string; default_account?: string }> } })?.data?.accounts;
    const account = accounts?.find((a) => a.company === company)?.default_account;
    if (!account) {
      throw new ErpError({
        kind: "validation_failed",
        message: `Mode of Payment ${mode} has no account for ${company}. Reconnect the business to ERPNext to set it up.`,
        correlationId,
      });
    }
    return account;
  }

  /**
   * Synchronize an AMBURAX Customer Payment Collection to an ERPNext Payment Entry.
   *
   * 1. Idempotency check: Looks for Payment Entry with `remarks` containing `amburax-payment-id:<paymentId>`.
   * 2. Resolves ERP Customer by AMBURAX `customerId` (`customer_pos_id`).
   * 3. Queries outstanding Sales Invoices for this customer.
   * 4. Allocates the collected payment amount against outstanding invoices FIFO (oldest first).
   * 5. Posts submitted Payment Entry (`docstatus: 1`) to ERPNext.
   */
  public async syncPayment(
    tenantId: string,
    paymentCollectionId: string,
    correlationId: string
  ): Promise<SyncPaymentResult> {
    const payment = await db.khataPayment.findUnique({
      where: { id: paymentCollectionId, tenantId },
      include: {
        customer: true,
      },
    });

    if (!payment) {
      throw new Error(`Khata payment ${paymentCollectionId} not found for tenant ${tenantId}`);
    }

    const envResult = await resolveErpEnvironment(tenantId);
    if (envResult.status !== "ok") {
      throw new ErpError({
        kind: "configuration_error",
        message: `ERP environment not provisioned for tenant ${tenantId}. Status: ${envResult.status}`,
        correlationId,
      });
    }

    const env = envResult.environment;
    const idempotencyRemark = `amburax-payment-id:${payment.id}`;

    // ── Idempotency Check ────────────────────────────────────────────────────
    const existingEntry = await this.lookupPaymentEntry(env, tenantId, idempotencyRemark, correlationId);
    if (existingEntry) {
      await db.khataPayment.update({
        where: { id: payment.id },
        data: {
          erpSyncStatus: "SYNCED",
          erpPaymentEntryId: existingEntry,
        },
      });
      return {
        paymentEntryId: existingEntry,
        allocatedInvoices: [],
        alreadySynced: true,
      };
    }

    // ── Resolve ERP Customer Name ───────────────────────────────────────────
    const custFilter = JSON.stringify([["customer_pos_id", "=", payment.customerId]]);
    const custFields = JSON.stringify(["name"]);
    const custPath = `/api/resource/Customer?filters=${encodeURIComponent(custFilter)}&fields=${encodeURIComponent(custFields)}`;

    const custRes = await this.client.call(
      env,
      { tenantId, correlationId, causationId: payment.id },
      { method: "GET", path: custPath }
    );
    const custBody = custRes.body as { data?: Array<{ name: string }> };
    let erpCustomerName: string | null = null;
    if (Array.isArray(custBody?.data) && custBody.data.length > 0 && custBody.data[0]?.name) {
      erpCustomerName = custBody.data[0].name;
    }

    if (!erpCustomerName) {
      throw new ErpError({
        kind: "validation_failed",
        message: `Cannot sync payment: Customer ${payment.customerId} (${payment.customer.name}) is not synced to ERPNext.`,
        correlationId,
      });
    }

    // ── Find Outstanding Sales Invoices for Customer ────────────────────────
    const invFilter = JSON.stringify([
      ["customer", "=", erpCustomerName],
      ["outstanding_amount", ">", 0],
      ["docstatus", "=", 1],
    ]);
    const invFields = JSON.stringify(["name", "outstanding_amount", "grand_total", "posting_date"]);
    const invPath = `/api/resource/Sales Invoice?filters=${encodeURIComponent(invFilter)}&fields=${encodeURIComponent(invFields)}&order_by=posting_date asc`;

    const invRes = await this.client.call(
      env,
      { tenantId, correlationId, causationId: payment.id },
      { method: "GET", path: invPath }
    );
    const invBody = invRes.body as {
      data?: Array<{ name: string; outstanding_amount: number; grand_total: number; posting_date: string }>;
    };
    const openInvoices = Array.isArray(invBody?.data) ? invBody.data : [];

    const amountToAllocate = payment.amountMinor / 100;
    let remainingAmount = amountToAllocate;
    const references: Array<{
      reference_doctype: "Sales Invoice";
      reference_name: string;
      total_amount: number;
      outstanding_amount: number;
      allocated_amount: number;
    }> = [];
    const allocatedInvoiceNames: string[] = [];

    // Allocate FIFO to open invoices
    for (const inv of openInvoices) {
      if (remainingAmount <= 0) break;
      const invOutstanding = Number(inv.outstanding_amount || 0);
      if (invOutstanding <= 0) continue;

      const allocation = Math.min(invOutstanding, remainingAmount);
      references.push({
        reference_doctype: "Sales Invoice",
        reference_name: inv.name,
        total_amount: Number(inv.grand_total || 0),
        outstanding_amount: invOutstanding,
        allocated_amount: allocation,
      });
      allocatedInvoiceNames.push(inv.name);
      remainingAmount -= allocation;
    }

    const company = requireCompany(env, correlationId);
    // No fallback abbreviation: guessing one would post against another company's Debtors.
    const compRes = await this.client.call(
      env,
      { tenantId, correlationId, causationId: payment.id },
      { method: "GET", path: `/api/resource/Company/${encodeURIComponent(company)}` }
    );
    const abbr = (compRes.body as { data?: { abbr?: string } })?.data?.abbr;
    if (!abbr) {
      throw new ErpError({ kind: "malformed_response", message: `Company ${company} has no abbreviation`, correlationId });
    }

    // The Mode of Payment names provisioning creates, and the account the owner linked to each
    // for this company (Mode of Payment Account) — which may be their real bank, not the placeholder.
    const modeOfPayment = MODE_OF_PAYMENT[payment.paymentMethod];
    const paidToAccount = await this.modeOfPaymentAccount(env, tenantId, modeOfPayment, company, correlationId, payment.id);
    const paidFromAccount = `Debtors - ${abbr}`;

    const paymentEntryPayload = {
      doctype: "Payment Entry",
      payment_type: "Receive",
      party_type: "Customer",
      party: erpCustomerName,
      company,
      posting_date: erpDate(payment.createdAt),
      paid_from: paidFromAccount,
      paid_to: paidToAccount,
      paid_amount: amountToAllocate,
      received_amount: amountToAllocate,
      mode_of_payment: modeOfPayment,
      remarks: `${idempotencyRemark}\nCustomer: ${payment.customer.name}\n${payment.notes ? "Notes: " + payment.notes : ""}`,
      references,
      docstatus: 1,
    };

    let paymentEntryId: string;
    try {
      const response = await this.client.call(
        env,
        { tenantId, correlationId, causationId: payment.id },
        {
          method: "POST",
          path: "/api/resource/Payment Entry",
          body: paymentEntryPayload,
          idempotencyKey: payment.id,
        }
      );

      const resBody = response.body as { data?: { name?: string } };
      if (!resBody?.data?.name) {
        throw new ErpError({
          kind: "malformed_response",
          message: "Payment Entry creation did not return a document name",
          correlationId,
        });
      }
      paymentEntryId = resBody.data.name;
    } catch (err) {
      // Check if it was created despite error (e.g. race condition)
      const fallback = await this.lookupPaymentEntry(env, tenantId, idempotencyRemark, correlationId);
      if (fallback) {
        paymentEntryId = fallback;
      } else {
        throw err;
      }
    }

    // Update AMBURAX record
    await db.khataPayment.update({
      where: { id: payment.id },
      data: {
        erpSyncStatus: "SYNCED",
        erpPaymentEntryId: paymentEntryId,
      },
    });

    return {
      paymentEntryId,
      allocatedInvoices: allocatedInvoiceNames,
      alreadySynced: false,
    };
  }
}
