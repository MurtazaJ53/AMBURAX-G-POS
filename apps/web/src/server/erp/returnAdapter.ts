import { db } from "@/server/db";
import { requireCompany, assertWarehouseCompanyMatch, inrPricingPayload, assertInrCurrencyGuard } from "@/server/erp/documentSync";
import { ErpClient } from "@/server/erp/client";
import { resolveErpEnvironment, EnvErpCredentialProvider } from "@/server/erp/config";
import type { ErpEnvironment } from "@/server/erp/config";
import { HttpErpTransport } from "@/server/erp/httpTransport";
import { ErpError } from "@/server/erp/errors";
import type { ErpTransport } from "@/server/erp/transport";
import { ErpCustomerAdapter } from "@/server/erp/customerAdapter";
import { buildGstInvoice, defaultGstAccounts } from "@/server/erp/gstInvoice";

export class ErpReturnAdapter {
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

  private async lookupReturnInvoiceByReturnId(
    env: ErpEnvironment,
    tenantId: string,
    returnId: string,
    correlationId: string
  ): Promise<{ name: string; docstatus: number } | null> {
    const filters = JSON.stringify([["amburax_sale_id", "=", returnId]]);
    const fields = JSON.stringify([
      "name",
      "docstatus",
      "currency",
      "price_list_currency",
      "conversion_rate",
      "plc_conversion_rate",
      "amburax_sale_id",
    ]);
    
    const path = `/api/resource/Sales Invoice?filters=${encodeURIComponent(filters)}&fields=${encodeURIComponent(fields)}`;

    const response = await this.client.call(
      env,
      { tenantId, correlationId, causationId: returnId },
      { method: "GET", path }
    );

    const body = response.body as {
      data?: Array<{
        name: string;
        docstatus?: number;
        amburax_sale_id: string;
      } & Record<string, unknown>>;
    };
    const data = body?.data;

    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }

    if (data.length === 1) {
      const doc = data[0]!;
      const docstatus = doc.docstatus ?? 0;
      // If found return invoice is still a draft (docstatus === 0), validate currency guard before returning/submitting
      if (docstatus === 0) {
        assertInrCurrencyGuard("Sales Invoice", doc.name, doc, correlationId, true);
      }
      return { name: doc.name, docstatus };
    }

    throw new ErpError({
      kind: "conflict",
      message: `Multiple Return Invoices found for AMBURAX return ID: ${returnId}`,
      correlationId,
    });
  }

  public async syncReturn(tenantId: string, returnId: string, correlationId: string): Promise<void> {
    const saleReturn = await db.saleReturn.findUnique({
      where: { id: returnId },
      include: {
        items: { include: { originalSaleItem: true } },
        payments: true,
        originalSale: {
          include: {
            store: { include: { company: { select: { code: true } } } },
            customer: { select: { gstin: true } },
            tenant: { select: { taxId: true } },
          },
        },
      },
    });

    if (!saleReturn) {
      throw new Error(`SaleReturn ${returnId} not found`);
    }

    if (saleReturn.erpSyncStatus === "SYNCED") {
      return; // Idempotent success
    }

    if (!saleReturn.originalSale.erpInvoiceId) {
      // Return cannot be synced to ERP until the original sale is synced to get the ERP invoice ID
      throw new Error(`Cannot sync return ${returnId}: Original sale ${saleReturn.originalSaleId} lacks erpInvoiceId. Outbox will retry.`);
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
    const existingReturnInvoice = await this.lookupReturnInvoiceByReturnId(
      envResult.environment,
      tenantId,
      saleReturn.id,
      correlationId
    );

    let invoiceId: string;

    if (existingReturnInvoice) {
      invoiceId = existingReturnInvoice.name;
      // If found draft (e.g. from timed out submit call on prior attempt), submit it
      if (existingReturnInvoice.docstatus === 0) {
        await this.client.call(
          envResult.environment,
          { tenantId, correlationId, causationId: saleReturn.id },
          {
            method: "PUT",
            path: `/api/resource/Sales Invoice/${encodeURIComponent(invoiceId)}`,
            body: { docstatus: 1 },
          }
        );
      }
    } else {
      // 2. Map to ERPNext Sales Invoice (Return)
      // ERPNext expects negative quantities for return invoices. A GST-registered business
      // reverses the GST too: each returned line's refund carries the same share of GST as the
      // line had when sold, sent as taxable value plus negative CGST/SGST (or IGST) rows.
      const supplierGstin = saleReturn.originalSale.tenant?.taxId?.trim().toUpperCase() || null;
      const abbr = saleReturn.originalSale.store.company?.code;
      const gst =
        supplierGstin && abbr
          ? buildGstInvoice({
              supplierGstin,
              customerGstin: saleReturn.originalSale.customer?.gstin,
              accounts: defaultGstAccounts(abbr),
              lines: saleReturn.items.map((item) => {
                const sold = item.originalSaleItem;
                const paid = sold.lineTotalMinor - sold.lineDiscountMinor;
                const taxMinor = paid > 0 ? Math.round((item.refundMinor * sold.taxMinor) / paid) : 0;
                return {
                  variantId: sold.variantId,
                  quantity: item.quantity,
                  unitPriceMinor: sold.unitPriceMinor,
                  lineDiscountMinor: 0,
                  taxMinor,
                  lineTotalMinor: item.refundMinor,
                };
              }),
            })
          : null;
      const items = gst
        ? gst.items.map((i) => ({ ...i, qty: -i.qty }))
        : saleReturn.items.map((item) => ({
            item_code: item.originalSaleItem.variantId,
            qty: -item.quantity, // Negative for return
            rate: item.originalSaleItem.unitPriceMinor / 100, // Positive rate
          }));

      // Payments are also negative in ERPNext POS Returns
      const payments = saleReturn.payments.map((p) => {
        let mode = "Cash";
        if (p.method === "UPI") mode = "UPI";
        else if (p.method === "CARD") mode = "Credit Card";
        return {
          mode_of_payment: mode,
          amount: -(p.amountMinor / 100), // Negative amount for refund
        };
      }).filter(p => p.amount !== 0);

      const company = requireCompany(envResult.environment, correlationId);
      await assertWarehouseCompanyMatch(this.client, envResult.environment, { tenantId, correlationId, causationId: saleReturn.id }, {
        storeId: saleReturn.storeId,
        warehouseId: saleReturn.originalSale.store.erpnextWarehouseId,
        expectedCompany: company,
      });

      // Resolve ERP Customer name if original sale had a customer
      let customerName = "Cash";
      if (saleReturn.originalSale.customerId) {
        try {
          const custFilter = JSON.stringify([["customer_pos_id", "=", saleReturn.originalSale.customerId]]);
          const custFields = JSON.stringify(["name"]);
          const custPath = `/api/resource/Customer?filters=${encodeURIComponent(custFilter)}&fields=${encodeURIComponent(custFields)}`;

          const custRes = await this.client.call(
            envResult.environment,
            { tenantId, correlationId, causationId: saleReturn.id },
            { method: "GET", path: custPath }
          );
          const custBody = custRes.body as { data?: Array<{ name: string }> };
          if (Array.isArray(custBody?.data) && custBody.data.length > 0 && custBody.data[0]?.name) {
            customerName = custBody.data[0].name;
          } else {
            // Lazy sync customer if not yet created in ERP
            const custAdapter = new ErpCustomerAdapter(this.transport);
            customerName = await custAdapter.syncCustomer(tenantId, saleReturn.originalSale.customerId, correlationId);
          }
        } catch (err) {
          customerName = "Cash";
        }
      }

      const invoiceDoc = {
        doctype: "Sales Invoice",
        ...inrPricingPayload("selling"),
        company: requireCompany(envResult.environment, correlationId),
        customer: customerName,
        is_pos: payments.length > 0 ? 1 : 0,
        is_return: 1,
        return_against: saleReturn.originalSale.erpInvoiceId,
        update_stock: 1,
        // Insert as draft (docstatus: 0), run currency guard on created doc, then submit
        docstatus: 0,
        set_warehouse: saleReturn.originalSale.store.erpnextWarehouseId, 
        items,
        ...(payments.length > 0 ? { payments } : {}),
        ...(gst ? { taxes: gst.taxes.map((t) => ({ ...t, tax_amount: -t.tax_amount })), company_gstin: supplierGstin } : {}),
        amburax_sale_id: saleReturn.id, // Deterministic idempotency key mapping
      };

      try {
        const response = await this.client.call(
          envResult.environment,
          { tenantId, correlationId, causationId: saleReturn.id },
          {
            method: "POST",
            path: "/api/resource/Sales Invoice",
            body: invoiceDoc,
            idempotencyKey: saleReturn.id, 
          }
        );

        const body = response.body as { data?: { name?: string } & Record<string, unknown> };
        if (!body?.data?.name) {
          throw new ErpError({
            kind: "malformed_response",
            message: "Return Sales Invoice creation did not return a document name",
            correlationId,
          });
        }
        assertInrCurrencyGuard("Sales Invoice", body.data.name, body.data, correlationId, true);
        invoiceId = body.data.name;

        // Submit the validated draft
        await this.client.call(
          envResult.environment,
          { tenantId, correlationId, causationId: saleReturn.id },
          {
            method: "PUT",
            path: `/api/resource/Sales Invoice/${encodeURIComponent(invoiceId)}`,
            body: { docstatus: 1 },
          }
        );
      } catch (err: unknown) {
        // Fallback lookup to defend against unique constraint races / lost responses
        const fallbackDoc = await this.lookupReturnInvoiceByReturnId(
          envResult.environment,
          tenantId,
          saleReturn.id,
          correlationId
        );
        if (fallbackDoc) {
          invoiceId = fallbackDoc.name;
          if (fallbackDoc.docstatus === 0) {
            await this.client.call(
              envResult.environment,
              { tenantId, correlationId, causationId: saleReturn.id },
              {
                method: "PUT",
                path: `/api/resource/Sales Invoice/${encodeURIComponent(invoiceId)}`,
                body: { docstatus: 1 },
              }
            );
          }
        } else {
          throw err;
        }
      }
    }

    // Persist success
    await db.saleReturn.update({
      where: { id: returnId },
      data: {
        erpSyncStatus: "SYNCED",
        erpInvoiceId: invoiceId,
      },
    });
  }
}
