import { db } from "@/server/db";
import { ErpClient } from "@/server/erp/client";
import { resolveErpEnvironment, EnvErpCredentialProvider } from "@/server/erp/config";
import type { ErpEnvironment } from "@/server/erp/config";
import { HttpErpTransport } from "@/server/erp/httpTransport";
import { ErpError } from "@/server/erp/errors";
import type { ErpTransport } from "@/server/erp/transport";
import { ErpCustomerAdapter } from "@/server/erp/customerAdapter";

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

  public async syncSale(tenantId: string, saleId: string, correlationId: string): Promise<void> {
    const sale = await db.sale.findUnique({
      where: { id: saleId },
      include: {
        items: true,
        payments: true,
        store: true,
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
      // 2. Map to ERPNext Sales Invoice
      const items = sale.items.map((item) => ({
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

      if (!sale.store.erpnextWarehouseId) {
        throw new ErpError({
          kind: "configuration_error",
          message: `Store ${sale.storeId} has no ERP warehouse provisioned. Cannot sync sale.`,
          correlationId,
        });
      }

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
        company: envResult.environment.companyId ?? "Amburax Retail",
        customer: customerName,
        is_pos: 1,
        update_stock: 1,
        // Submitted on insert, not left as a draft. A draft posts nothing: no stock leaves the
        // warehouse, and an udhar bill's unpaid amount never becomes an outstanding receivable,
        // so the customer's khata in the ledger (which reads submitted invoices) would miss it.
        docstatus: 1,
        set_warehouse: sale.store.erpnextWarehouseId, 
        items,
        payments,
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
