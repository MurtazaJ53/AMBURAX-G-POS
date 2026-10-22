import { db } from "@/server/db";
import { requireCompany, assertWarehouseCompanyMatch } from "@/server/erp/documentSync";
import { ErpClient } from "@/server/erp/client";
import { resolveErpEnvironment, EnvErpCredentialProvider } from "@/server/erp/config";
import type { ErpEnvironment } from "@/server/erp/config";
import { HttpErpTransport } from "@/server/erp/httpTransport";
import { ErpError } from "@/server/erp/errors";
import type { ErpTransport } from "@/server/erp/transport";
import { ErpCustomerAdapter } from "@/server/erp/customerAdapter";
import { buildGstInvoice, defaultGstAccounts, type GstAccounts } from "@/server/erp/gstInvoice";

export class ErpSaleAdapter {
  private client: ErpClient;
  private transport?: ErpTransport;

  constructor(transport?: ErpTransport) {
    this.transport = transport;
    this.client = new ErpClient(
      transport ?? new HttpErpTransport(),
      new EnvErpCredentialProvider(),
      {}
    );
  }

  private async lookupInvoiceBySaleId(
    env: ErpEnvironment,
    tenantId: string,
    saleId: string,
    correlationId: string
  ): Promise<string | null> {
    const filters = JSON.stringify([["amburax_sale_id", "=", saleId]]);
    const fields = JSON.stringify(["name", "amburax_sale_id"]);
    
    const path = `/api/resource/Sales Invoice?filters=${encodeURIComponent(filters)}&fields=${encodeURIComponent(fields)}`;

    const response = await this.client.call(
      env,
      { tenantId, correlationId, causationId: saleId },
      { method: "GET", path }
    );

    const body = response.body as { data?: Array<{ name: string; amburax_sale_id: string }> };
    const data = body?.data;

    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }

    if (data.length === 1) {
      return data[0]?.name ?? null;
    }

    throw new ErpError({
      kind: "conflict",
      message: `Multiple Sales Invoices found for AMBURAX sale ID: ${saleId}`,
      correlationId,
    });
  }

  private readonly checkedGstAccounts = new Map<string, GstAccounts>();

  /**
   * The company's output GST accounts. A missing one is a setup problem worth naming, so the sale
   * waits with a clear reason instead of ERPNext's generic refusal. If the integration user may
   * not read accounts, the standard names are used and ERPNext validates them on submit.
   */
  private async gstAccounts(env: ErpEnvironment, tenantId: string, abbr: string, correlationId: string): Promise<GstAccounts> {
    const key = `${tenantId}:${abbr}`;
    const cached = this.checkedGstAccounts.get(key);
    if (cached) return cached;
    const accounts = defaultGstAccounts(abbr);
    for (const name of [accounts.cgst, accounts.sgst, accounts.igst]) {
      try {
        await this.client.call(env, { tenantId, correlationId }, { method: "GET", path: `/api/resource/Account/${encodeURIComponent(name)}` });
      } catch (err) {
        if (err instanceof ErpError && err.kind === "not_found") {
          throw new ErpError({
            kind: "configuration_error",
            message: `ERPNext has no "${name}" account. Add the GST accounts to the company (Chart of Accounts > Duties and Taxes) and the sale will sync.`,
            correlationId,
          });
        }
        if (!(err instanceof ErpError && (err.kind === "authorization_failed" || err.kind === "authentication_failed"))) throw err;
      }
    }
    this.checkedGstAccounts.set(key, accounts);
    return accounts;
  }

  public async syncSale(tenantId: string, saleId: string, correlationId: string): Promise<void> {
    const sale = await db.sale.findUnique({
      where: { id: saleId },
      include: {
        items: true,
        payments: true,
        store: { include: { company: { select: { code: true } } } },
        customer: { select: { gstin: true } },
        tenant: { select: { taxId: true } },
      },
    });

    if (!sale) {
      throw new Error(`Sale ${saleId} not found`);
    }

    if (sale.erpSyncStatus === "SYNCED") {
      // Already synced locally, idempotent success
      return;
    }

    const envResult = await resolveErpEnvironment(tenantId);
    
    if (envResult.status !== "ok") {
      throw new ErpError({
        kind: "configuration_error",
        message: `ERP environment not provisioned for tenant ${tenantId}. Status: ${envResult.status}`,
        correlationId,
      });
    }

    // 1. Initial Lookup
    const existingInvoiceId = await this.lookupInvoiceBySaleId(
      envResult.environment,
      tenantId,
      sale.id,
      correlationId
    );

    let invoiceId: string;

    if (existingInvoiceId) {
      invoiceId = existingInvoiceId;
    } else {
      // 2. Map to ERPNext Sales Invoice. A GST-registered business sends taxable values plus
      // CGST/SGST or IGST rows (see gstInvoice.ts); a business without a GSTIN sends prices as
      // paid, with no tax rows and the bill discount on the grand total, as before.
      const supplierGstin = sale.tenant?.taxId?.trim().toUpperCase() || null;
      let gst: ReturnType<typeof buildGstInvoice> | null = null;
      if (supplierGstin) {
        const abbr = sale.store.company?.code;
        if (!abbr) {
          throw new ErpError({
            kind: "configuration_error",
            message: `Store ${sale.storeId} isn't linked to an ERPNext company, so its GST accounts can't be named.`,
            correlationId,
          });
        }
        const accounts = await this.gstAccounts(envResult.environment, tenantId, abbr, correlationId);
        gst = buildGstInvoice({ lines: sale.items, supplierGstin, customerGstin: sale.customer?.gstin, accounts });
      }
      const items = gst
        ? gst.items
        : sale.items.map((item) => ({
            item_code: item.variantId,
            qty: item.quantity,
            rate: item.unitPriceMinor / 100,
          }));

      const payments = sale.payments.map((p) => {
        let mode = "Cash";
        if (p.method === "UPI") mode = "UPI";
        else if (p.method === "CARD") mode = "Credit Card";
        return {
          mode_of_payment: mode,
          amount: p.amountMinor / 100,
        };
      }).filter(p => p.amount > 0);

      const company = requireCompany(envResult.environment, correlationId);
      await assertWarehouseCompanyMatch(this.client, envResult.environment, { tenantId, correlationId, causationId: sale.id }, {
        storeId: sale.storeId,
        warehouseId: sale.store.erpnextWarehouseId,
        expectedCompany: company,
      });

      // Resolve ERP Customer name if sale has a customer
      let customerName = "Cash";
      if (sale.customerId) {
        try {
          const custFilter = JSON.stringify([["customer_pos_id", "=", sale.customerId]]);
          const custFields = JSON.stringify(["name"]);
          const custPath = `/api/resource/Customer?filters=${encodeURIComponent(custFilter)}&fields=${encodeURIComponent(custFields)}`;

          const custRes = await this.client.call(
            envResult.environment,
            { tenantId, correlationId, causationId: sale.id },
            { method: "GET", path: custPath }
          );
          const custBody = custRes.body as { data?: Array<{ name: string }> };
          if (Array.isArray(custBody?.data) && custBody.data.length > 0 && custBody.data[0]?.name) {
            customerName = custBody.data[0].name;
          } else {
            // Lazy sync customer if not yet created in ERP
            const custAdapter = new ErpCustomerAdapter(this.transport);
            customerName = await custAdapter.syncCustomer(tenantId, sale.customerId, correlationId);
          }
        } catch (err) {
          // A paid bill can fall back to the walk-in "Cash" customer and lose nothing. A bill
          // with udhar cannot: its outstanding amount would land on "Cash" and vanish from the
          // customer's khata. So it waits and retries until the customer itself is synced.
          if (sale.paidMinor < sale.totalMinor) throw err;
          customerName = "Cash";
        }
      }

      const invoiceDoc = {
        doctype: "Sales Invoice",
        company: requireCompany(envResult.environment, correlationId),
        customer: customerName,
        currency: "INR",
        conversion_rate: 1,
        selling_price_list: "Standard Selling",
        price_list_currency: "USD",
        plc_conversion_rate: 85,
        is_pos: payments.length > 0 ? 1 : 0,
        update_stock: 1,
        // Submitted on insert, not left as a draft. A draft posts nothing: no stock leaves the
        // warehouse, and an udhar bill's unpaid amount never becomes an outstanding receivable,
        // so the customer's khata in the ledger (which reads submitted invoices) would miss it.
        docstatus: 1,
        set_warehouse: sale.store.erpnextWarehouseId, 
        items,
        ...(payments.length > 0 ? { payments } : {}),
        // With GST the lines are already net of the bill discount and the tax rows carry the GST.
        // Without it, a bill discount is ERPNext's invoice-level discount on the grand total.
        // Either way the invoice total equals what the customer paid.
        ...(gst
          ? {
              taxes: gst.taxes,
              company_gstin: supplierGstin,
              ...(sale.customer?.gstin ? { billing_address_gstin: sale.customer.gstin } : {}),
            }
          : sale.discountMinor > 0
            ? { apply_discount_on: "Grand Total", discount_amount: sale.discountMinor / 100 }
            : {}),
        amburax_sale_id: sale.id,
      };

      try {
        const response = await this.client.call(
          envResult.environment,
          { tenantId, correlationId, causationId: sale.id },
          {
            method: "POST",
            path: "/api/resource/Sales Invoice",
            body: invoiceDoc,
            idempotencyKey: sale.id, 
          }
        );

        const body = response.body as { data?: { name?: string } };
        if (!body?.data?.name) {
          throw new ErpError({
            kind: "malformed_response",
            message: "Sales Invoice creation did not return a document name",
            correlationId,
          });
        }
        invoiceId = body.data.name;
      } catch (err: unknown) {
        // If ERPNext refuses submission due to insufficient ledger stock in the warehouse
        // (NegativeStockError), post the financial invoice without update_stock so receivables,
        // payments, and GST are faithfully synchronized rather than blocking the till.
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes("needed in Warehouse") || errMsg.includes("Insufficient Stock") || errMsg.includes("NegativeStockError")) {
          try {
            const fallbackResponse = await this.client.call(
              envResult.environment,
              { tenantId, correlationId, causationId: sale.id },
              {
                method: "POST",
                path: "/api/resource/Sales Invoice",
                body: { ...invoiceDoc, update_stock: 0 },
                idempotencyKey: sale.id,
              }
            );
            const fbBody = fallbackResponse.body as { data?: { name?: string } };
            if (fbBody?.data?.name) {
              invoiceId = fbBody.data.name;
            } else {
              throw err;
            }
          } catch {
            throw err;
          }
        } else {
          // Fallback lookup to defend against unique constraint races
          const fallbackId = await this.lookupInvoiceBySaleId(
            envResult.environment,
            tenantId,
            sale.id,
            correlationId
          );
          if (fallbackId) {
            invoiceId = fallbackId;
          } else {
            throw err;
          }
        }
      }
    }

    // Persist success
    await db.sale.update({
      where: { id: saleId },
      data: {
        erpSyncStatus: "SYNCED",
        erpInvoiceId: invoiceId,
      },
    });
  }
}
