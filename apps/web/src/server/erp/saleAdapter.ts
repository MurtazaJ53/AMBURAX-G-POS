import { db } from "@/server/db";
import { ErpClient } from "@/server/erp/client";
import { resolveErpEnvironment, EnvErpCredentialProvider } from "@/server/erp/config";
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

  async syncSale(tenantId: string, saleId: string, correlationId: string): Promise<void> {
    const envResult = await resolveErpEnvironment(tenantId);
    
    // If there is no ERP environment, this is a permanent failure for this event,
    // but the outbox logic might retry it. We throw so it goes to DLQ eventually,
    // OR we could ignore it. The prompt says "ERPNext REMAINS THE PRIMARY ERP...
    // AMBURAX PostgreSQL remains the operational projection". 
    // If not provisioned, we should throw so the outbox retries.
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
      // Already synced, idempotent success
      return;
    }

    // Map to ERPNext Sales Invoice (which also updates stock if is_pos=1 and update_stock=1)
    const items = sale.items.map((item) => ({
      item_code: item.variantId,
      qty: item.quantity,
      rate: item.unitPriceMinor / 100,
    }));

    const payments = [
      {
        mode_of_payment: sale.paidMinor > 0 ? "Cash" : undefined, // Simplify mapping for MVP
        amount: sale.paidMinor / 100,
      }
    ].filter(p => p.amount > 0);

    const invoiceDoc = {
      doctype: "Sales Invoice",
      company: envResult.environment.companyId ?? "Amburax Retail",
      customer: sale.customerId ?? "Cash",
      is_pos: 1,
      update_stock: 1,
      set_warehouse: sale.store.erpnextWarehouseId ?? "Stores", 
      items,
      payments,
      // Pass the AMBURAX sale ID so we can query it later or prevent duplicates
      amburax_sale_id: sale.id, 
    };

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
    const invoiceId = body?.data?.name;

    if (!invoiceId) {
      throw new ErpError({
        kind: "malformed_response",
        message: "Sales Invoice creation did not return a document name",
        correlationId,
      });
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
