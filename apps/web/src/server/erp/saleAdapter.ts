import { db } from "@/server/db";
import { ErpClient } from "@/server/erp/client";
import { resolveErpEnvironment, EnvErpCredentialProvider } from "@/server/erp/config";
import type { ErpEnvironment } from "@/server/erp/config";
import { HttpErpTransport } from "@/server/erp/httpTransport";
import { ErpError } from "@/server/erp/errors";
import type { ErpTransport } from "@/server/erp/transport";

export class ErpSaleAdapter {
  private client: ErpClient;

  constructor(transport?: ErpTransport) {
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
      {
        method: "GET",
        path,
      }
    );

    const body = response.body as { data?: Array<{ name: string; amburax_sale_id: string }> };
    const data = body?.data;

    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }

    if (data.length === 1) {
      const first = data[0];
      if (!first?.name) {
         return null;
      }
      return first.name;
    }

    throw new ErpError({
      kind: "conflict",
      message: `Multiple Sales Invoices found for AMBURAX sale ID: ${saleId}`,
      correlationId,
    });
  }

  async syncSale(tenantId: string, saleId: string, correlationId: string): Promise<void> {
    const envResult = await resolveErpEnvironment(tenantId);
    
    if (envResult.status !== "ok") {
      throw new ErpError({
        kind: "configuration_error",
        message: `ERP environment not provisioned for tenant ${tenantId}. Status: ${envResult.status}`,
        correlationId,
      });
    }

    const sale = await db.sale.findUnique({
      where: { id: saleId },
      include: { items: true, customer: true, store: true },
    });

    if (!sale) {
      throw new Error(`Sale ${saleId} not found`);
    }

    if (sale.erpSyncStatus === "SYNCED") {
      // Already synced locally, idempotent success
      return;
    }

    // 1. Initial Lookup
    let existingInvoiceId = await this.lookupInvoiceBySaleId(envResult.environment, tenantId, sale.id, correlationId);
    
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

      const payments = [
        {
          mode_of_payment: sale.paidMinor > 0 ? "Cash" : undefined,
          amount: sale.paidMinor / 100,
        }
      ].filter(p => p.amount > 0);

      if (!sale.store.erpnextWarehouseId) {
        throw new ErpError({
          kind: "configuration_error",
          message: `Store ${sale.storeId} has no ERP warehouse provisioned. Cannot sync sale.`,
          correlationId,
        });
      }

      const invoiceDoc = {
        doctype: "Sales Invoice",
        company: envResult.environment.companyId ?? "Amburax Retail",
        customer: sale.customerId ?? "Cash",
        is_pos: 1,
        update_stock: 1,
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
        // 3. Fallback lookup to defend against unique constraint races or timeouts where ERPNext actually succeeded
        const fallbackId = await this.lookupInvoiceBySaleId(envResult.environment, tenantId, sale.id, correlationId);
        
        if (fallbackId) {
          invoiceId = fallbackId;
        } else {
          // It was a real failure, not a duplicate race condition. Re-throw it so outbox can retry or DLQ
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
