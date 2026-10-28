import { db } from "@/server/db";
import type { ErpCallContext, ErpClient } from "@/server/erp/client";
import type { ErpEnvironment } from "@/server/erp/config";
import { ErpError } from "@/server/erp/errors";
import type { ErpTransport } from "@/server/erp/transport";
import { ErpSupplierAdapter } from "@/server/erp/supplierAdapter";
import { gstinStateCode, gstStateCode } from "@/lib/gstStates";
import { lineInputTax } from "@/server/purchasing/purchaseReceipts";
import {
  createDocument,
  erpDate,
  erpText,
  findDocumentName,
  newErpClient,
  requireErpEnvironment,
  requireCompany,
  assertWarehouseCompanyMatch,
  inrPricingPayload,
} from "@/server/erp/documentSync";

const RECEIPT_REMARKS = "amburax-purchase-receipt-id:";
const INVOICE_REMARKS = "amburax-purchase-invoice-id:";
const RETURN_REMARKS = "amburax-purchase-return-id:";
const ORDER_REMARKS = "amburax-purchase-order-id:";
const TEMPLATE_DOCTYPE = "Purchase Taxes and Charges Template";

function loadReceipt(tenantId: string, receiptId: string) {
  return db.purchaseReceipt.findUnique({
    where: { id: receiptId, tenantId },
    include: {
      supplier: true,
      lines: { include: { purchaseOrderLine: { select: { erpnextItemName: true } } } },
      store: { select: { state: true, erpnextWarehouseId: true } },
      purchaseOrder: { select: { id: true, erpnextName: true } },
      tenant: { select: { taxId: true } },
    },
  });
}
type LoadedReceipt = NonNullable<Awaited<ReturnType<typeof loadReceipt>>>;

function loadOrder(tenantId: string, orderId: string) {
  return db.purchaseOrder.findUnique({
    where: { id: orderId, tenantId },
    include: {
      supplier: true,
      lines: { orderBy: { id: "asc" } },
      store: { select: { state: true, erpnextWarehouseId: true } },
      tenant: { select: { taxId: true } },
    },
  });
}

/** What the GST decision needs: both GSTINs and the receiving store's state. */
type GstParty = {
  storeId: string;
  supplier: { gstin: string | null };
  store: { state: string };
  tenant: { taxId: string | null };
};

/**
 * Whether this business can claim input tax credit. A business without a GSTIN can't (CGST Act
 * s.16): the GST it pays is part of what the stock cost (AS-2), so it rides in the item rate and
 * no tax rows are sent. Owner confirmed 2026-10-20.
 */
export function claimsInputTax(party: { tenant: { taxId: string | null } }): boolean {
  return Boolean(party.tenant.taxId?.trim());
}

/** Unit rate for ERPNext: cost excluding GST, plus this line's GST when it can't be claimed. */
export function erpUnitRate(unitCostMinor: number, quantity: number, inputTaxMinor: number, claims: boolean): number {
  if (claims || quantity === 0) return unitCostMinor / 100;
  return (unitCostMinor * quantity + inputTaxMinor) / quantity / 100;
}

type TaxRow = {
  charge_type: "Actual";
  account_head: string;
  description: string;
  tax_amount: number;
  category: "Total";
  add_deduct_tax: "Add";
};

/**
 * AMBURAX purchases → ERPNext. ERPNext is the master for purchasing, stock valuation and GST.
 *
 *   receipt          → submitted Purchase Receipt (stock in, valued at cost excluding GST)
 *                    + draft Purchase Invoice from it (the bill; ITC is claimed from this)
 *   supplier return  → submitted Purchase Receipt with is_return against the original
 *
 * GST (owner + CA approved 2026-10-14): the tax type follows the law, not a setting — a supplier
 * in the receiving store's state is intra-state (CGST + SGST), any other state is inter-state (IGST)
 * (IGST Act ss. 7, 8, 10). The amounts are the input GST AMBURAX recorded, sent as "Actual" rows on
 * the account heads of the tenant's In-State / Out-State template. An unregistered supplier (no
 * GSTIN) carries no GST rows: there is no input tax credit to claim.
 *
 * The Purchase Invoice stays a draft on purpose: input tax credit needs the supplier's invoice
 * in hand and in GSTR-2B (CGST Act s.16(2)), so the accountant checks it before submitting.
 *
 * Idempotent: the AMBURAX id is stamped in `remarks`; a re-delivery finds that document and stops.
 */
export class ErpPurchaseAdapter {
  private client: ErpClient;
  private suppliers: ErpSupplierAdapter;

  constructor(transport?: ErpTransport) {
    this.client = newErpClient(transport);
    this.suppliers = new ErpSupplierAdapter(transport);
  }

  private async warehouseOf(
    env: ErpEnvironment,
    ctx: ErpCallContext,
    receipt: { storeId: string; store: { erpnextWarehouseId: string | null } },
  ): Promise<string> {
    const company = requireCompany(env, ctx.correlationId);
    await assertWarehouseCompanyMatch(this.client, env, ctx, {
      storeId: receipt.storeId,
      warehouseId: receipt.store.erpnextWarehouseId,
      expectedCompany: company,
    });
    return receipt.store.erpnextWarehouseId!;
  }

  private async supplierNameOf(
    receipt: { supplierId: string; supplier: { erpnextName: string | null } },
    tenantId: string,
    correlationId: string,
  ): Promise<string> {
    return receipt.supplier.erpnextName ?? this.suppliers.syncSupplier(tenantId, receipt.supplierId, correlationId);
  }

  /**
   * The GST rows for one document. `taxMinor` is signed (negative on a return). Throws rather than
   * guessing when the store's state is unknown or ERPNext has no matching template.
   */
  private async gstRows(env: ErpEnvironment, ctx: ErpCallContext, receipt: GstParty, taxMinor: number): Promise<TaxRow[]> {
    const supplierCode = gstinStateCode(receipt.supplier.gstin);
    if (!supplierCode || taxMinor === 0 || !claimsInputTax(receipt)) return [];
    const storeCode = gstStateCode(receipt.store.state);
    if (!storeCode) {
      throw new ErpError({
        kind: "configuration_error",
        message: `Store ${receipt.storeId}: its state is not a recognised GST state, so CGST/SGST vs IGST cannot be decided.`,
        correlationId: ctx.correlationId,
      });
    }
    const intraState = supplierCode === storeCode;
    const category = intraState ? "In-State" : "Out-State";

    const filters: unknown[] = [["tax_category", "=", category]];
    if (env.companyId) filters.push(["company", "=", env.companyId]);
    const list = await this.client.call(env, ctx, {
      method: "GET",
      path: `/api/resource/${TEMPLATE_DOCTYPE}?filters=${encodeURIComponent(JSON.stringify(filters))}&fields=${encodeURIComponent(
        JSON.stringify(["name"]),
      )}&limit_page_length=1`,
    });
    const templateName = (list.body as { data?: Array<{ name: string }> })?.data?.[0]?.name;
    if (!templateName) {
      throw new ErpError({
        kind: "configuration_error",
        message: `ERPNext has no ${category} purchase GST template for this company.`,
        correlationId: ctx.correlationId,
      });
    }
    const doc = await this.client.call(env, ctx, {
      method: "GET",
      path: `/api/resource/${TEMPLATE_DOCTYPE}/${encodeURIComponent(templateName)}`,
    });
    const heads = ((doc.body as { data?: { taxes?: Array<{ account_head: string }> } })?.data?.taxes ?? []).map(
      (t) => t.account_head,
    );
    const head = (kind: string) => {
      const found = heads.find((h) => h.toUpperCase().includes(kind));
      if (!found) {
        throw new ErpError({
          kind: "configuration_error",
          message: `The ${category} GST template has no ${kind} account.`,
          correlationId: ctx.correlationId,
        });
      }
      return found;
    };
    const row = (kind: string, minor: number): TaxRow => ({
      charge_type: "Actual",
      account_head: head(kind),
      description: kind,
      tax_amount: minor / 100,
      category: "Total",
      add_deduct_tax: "Add",
    });

    if (!intraState) return [row("IGST", taxMinor)];
    // Half each; an odd paisa goes to SGST so the two always add up to what AMBURAX recorded.
    const cgst = Math.trunc(taxMinor / 2);
    return [row("CGST", cgst), row("SGST", taxMinor - cgst)];
  }

  public async syncReceipt(tenantId: string, receiptId: string, correlationId: string): Promise<string> {
    let receipt = await loadReceipt(tenantId, receiptId);
    if (!receipt) throw new Error(`Purchase receipt ${receiptId} not found for tenant ${tenantId}`);
    if (receipt.erpSyncStatus === "SYNCED" && receipt.erpnextName && receipt.erpnextInvoiceName) return receipt.erpnextName;
    if (receipt.purchaseOrder && !receipt.purchaseOrder.erpnextName) {
      // A receipt against an order cites the order's rows, so the order must be in ERPNext first.
      await this.syncOrder(tenantId, receipt.purchaseOrder.id, correlationId);
      receipt = (await loadReceipt(tenantId, receiptId))!;
    }

    try {
      const env = await requireErpEnvironment(tenantId, correlationId);
      const ctx = { tenantId, correlationId, causationId: receipt.id };
      const taxes = await this.gstRows(env, ctx, receipt, receipt.inputTaxMinor);
      // Resolved once: both documents name the same ERPNext supplier.
      const supplierName = await this.supplierNameOf(receipt, tenantId, correlationId);
      const name = receipt.erpnextName ?? (await this.ensureReceipt(env, ctx, supplierName, receipt, taxes));
      await db.purchaseReceipt.update({ where: { id: receipt.id, tenantId }, data: { erpnextName: name } });
      try {
        const invoice = await this.ensureInvoice(env, ctx, supplierName, receipt, name, taxes);
        await db.purchaseReceipt.update({
          where: { id: receipt.id, tenantId },
          data: { erpnextInvoiceName: invoice, erpSyncStatus: "SYNCED" },
        });
      } catch (invErr) {
        // The stock (receipt) is in; the bill is not. Never report that as synced: input tax credit
        // is claimed from the bill. The receipt stays FAILED with the reason, and a retry sends only
        // the missing bill (the receipt name is already saved above). A currency mismatch is
        // prevented at the source: suppliers are always created in the company currency.
        const errMsg = String(invErr);
        if (errMsg.includes("Party Account") || errMsg.includes("Currency must be equal to")) {
          throw new ErpError({
            kind: "validation_failed",
            message: `Stock arrived but the supplier's bill was refused: the supplier's payable account is in another currency. Set the supplier's currency to INR in the accounting and retry. (${errMsg.slice(0, 200)})`,
            correlationId,
          });
        }
        throw invErr;
      }
      return name;
    } catch (error) {
      await db.purchaseReceipt.update({ where: { id: receipt.id, tenantId }, data: { erpSyncStatus: "FAILED" } });
      throw error;
    }
  }

  private items(receipt: LoadedReceipt, warehouse: string, extra: (lineId: string) => Record<string, unknown> = () => ({})) {
    const order = receipt.purchaseOrder?.erpnextName ?? null;
    const claims = claimsInputTax(receipt);
    return receipt.lines.map((line) => ({
      ...(order && line.purchaseOrderLine?.erpnextItemName
        ? { purchase_order: order, purchase_order_item: line.purchaseOrderLine.erpnextItemName }
        : {}),
      item_code: line.variantId,
      qty: line.quantity,
      received_qty: line.quantity,
      rate: erpUnitRate(line.unitCostMinor, line.quantity, line.inputTaxMinor, claims),
      warehouse,
      uom: "Nos",
      stock_uom: "Nos",
      conversion_factor: 1,
      ...extra(line.id),
    }));
  }

  private async ensureReceipt(
    env: ErpEnvironment,
    ctx: ErpCallContext,
    supplierName: string,
    receipt: LoadedReceipt,
    taxes: TaxRow[],
  ): Promise<string> {
    // TODO: migrate remarks lookup to custom field amburax_source_id
    const remarks = `${RECEIPT_REMARKS}${receipt.id}`;
    const found = await findDocumentName(this.client, env, ctx, "Purchase Receipt", "remarks", remarks);
    if (found) return found;

    const warehouse = await this.warehouseOf(env, ctx, receipt);
    return createDocument(
      this.client,
      env,
      ctx,
      "Purchase Receipt",
      {
        ...inrPricingPayload("buying"),
        supplier: supplierName,
        company: env.companyId ?? undefined,
        posting_date: erpDate(receipt.createdAt),
        set_posting_time: 1,
        set_warehouse: warehouse,
        supplier_delivery_note: erpText(receipt.supplierInvoiceNo),
        remarks,
        items: this.items(receipt, warehouse),
        taxes,
      },
      `purchase-receipt:${receipt.id}`,
      true,
    );
  }

  /** The supplier's bill, as a draft Purchase Invoice against the receipt (no second stock move). */
  private async ensureInvoice(
    env: ErpEnvironment,
    ctx: ErpCallContext,
    supplierName: string,
    receipt: LoadedReceipt,
    receiptName: string,
    taxes: TaxRow[],
  ): Promise<string> {
    if (receipt.erpnextInvoiceName) return receipt.erpnextInvoiceName;
    // TODO: migrate remarks lookup to custom field amburax_source_id
    const remarks = `${INVOICE_REMARKS}${receipt.id}`;
    const found = await findDocumentName(this.client, env, ctx, "Purchase Invoice", "remarks", remarks);
    if (found) return found;

    const warehouse = await this.warehouseOf(env, ctx, receipt);
    return createDocument(
      this.client,
      env,
      ctx,
      "Purchase Invoice",
      {
        ...inrPricingPayload("buying"),
        supplier: supplierName,
        company: env.companyId ?? undefined,
        posting_date: erpDate(receipt.createdAt),
        set_posting_time: 1,
        bill_no: erpText(receipt.supplierInvoiceNo),
        bill_date: receipt.supplierInvoiceDate ? erpDate(receipt.supplierInvoiceDate) : undefined,
        update_stock: 0,
        remarks,
        // Against the receipt, so the backend books it to the company's own "Stock Received But Not
        // Billed" account; no account name is guessed here.
        items: this.items(receipt, warehouse, () => ({ purchase_receipt: receiptName })),
        taxes,
      },
      `purchase-invoice:${receipt.id}`,
      false,
    );
  }

  public async syncReturn(tenantId: string, returnId: string, correlationId: string): Promise<string> {
    const purchaseReturn = await db.purchaseReturn.findUnique({
      where: { id: returnId, tenantId },
      include: { lines: { include: { receiptLine: true } } },
    });
    if (!purchaseReturn) throw new Error(`Purchase return ${returnId} not found for tenant ${tenantId}`);
    if (purchaseReturn.erpSyncStatus === "SYNCED" && purchaseReturn.erpnextName) return purchaseReturn.erpnextName;

    try {
      const env = await requireErpEnvironment(tenantId, correlationId);
      const ctx = { tenantId, correlationId, causationId: purchaseReturn.id };
      // TODO: migrate remarks lookup to custom field amburax_source_id
      const remarks = `${RETURN_REMARKS}${purchaseReturn.id}`;
      let name = await findDocumentName(this.client, env, ctx, "Purchase Receipt", "remarks", remarks);

      if (!name) {
        // A return must point at the receipt it reverses, so the original goes first.
        const original = await this.syncReceipt(tenantId, purchaseReturn.receiptId, correlationId);
        const receipt = await loadReceipt(tenantId, purchaseReturn.receiptId);
        if (!receipt) throw new Error(`Purchase receipt ${purchaseReturn.receiptId} not found for tenant ${tenantId}`);
        const warehouse = await this.warehouseOf(env, ctx, receipt);
        const supplierName = await this.supplierNameOf(receipt, tenantId, correlationId);
        const taxes = await this.gstRows(env, ctx, receipt, -purchaseReturn.inputTaxMinor);

        name = await createDocument(
          this.client,
          env,
          ctx,
          "Purchase Receipt",
          {
            ...inrPricingPayload("buying"),
            supplier: supplierName,
            company: env.companyId ?? undefined,
            is_return: 1,
            return_against: original,
            posting_date: erpDate(purchaseReturn.createdAt),
            set_posting_time: 1,
            set_warehouse: warehouse,
            // remarks holds only the id so the lookup matches exactly; the reason rides alongside.
            remarks,
            supplier_delivery_note: erpText(purchaseReturn.reason),
            items: purchaseReturn.lines.map((line) => ({
              item_code: line.receiptLine.variantId,
              qty: -line.quantity,
              received_qty: -line.quantity,
              rate: erpUnitRate(line.receiptLine.unitCostMinor, line.quantity, line.inputTaxMinor, claimsInputTax(receipt)),
              warehouse,
              uom: "Nos",
              stock_uom: "Nos",
              conversion_factor: 1,
            })),
            taxes,
          },
          `purchase-return:${purchaseReturn.id}`,
          true,
        );
      }

      await db.purchaseReturn.update({
        where: { id: purchaseReturn.id, tenantId },
        data: { erpnextName: name, erpSyncStatus: "SYNCED" },
      });
      return name;
    } catch (error) {
      await db.purchaseReturn.update({ where: { id: purchaseReturn.id, tenantId }, data: { erpSyncStatus: "FAILED" } });
      throw error;
    }
  }

  /**
   * AMBURAX purchase order -> submitted ERPNext Purchase Order, with the same GST rows a receipt
   * would carry. After submitting, each ERPNext row name is kept on its AMBURAX line so receipts can
   * cite it. Idempotent through the mapping and the `title` stamp.
   */
  public async syncOrder(tenantId: string, orderId: string, correlationId: string): Promise<string> {
    const order = await loadOrder(tenantId, orderId);
    if (!order) throw new Error(`Purchase order ${orderId} not found for tenant ${tenantId}`);
    if (order.erpnextName && order.lines.every((l) => l.erpnextItemName)) return order.erpnextName;

    try {
      const env = await requireErpEnvironment(tenantId, correlationId);
      const ctx = { tenantId, correlationId, causationId: order.id };
      // TODO: migrate remarks lookup to custom field amburax_source_id
      const stamp = `${ORDER_REMARKS}${order.id}`;
      let name = order.erpnextName ?? (await findDocumentName(this.client, env, ctx, "Purchase Order", "title", stamp));
      if (!name) {
        const supplierName = await this.supplierNameOf(order, tenantId, correlationId);
        const warehouse = await this.warehouseOf(env, ctx, order);
        const tax = order.lines.reduce((sum, l) => sum + lineInputTax(l.quantity * l.unitCostMinor, l.gstRateBp), 0);
        const taxes = await this.gstRows(env, ctx, order, tax);
        const due = erpDate(order.expectedDate);
        name = await createDocument(
          this.client,
          env,
          ctx,
          "Purchase Order",
          {
            ...inrPricingPayload("buying"),
            title: stamp,
            supplier: supplierName,
            company: env.companyId ?? undefined,
            transaction_date: erpDate(order.createdAt),
            schedule_date: due,
            set_warehouse: warehouse,
            items: order.lines.map((l) => ({
              item_code: l.variantId,
              qty: l.quantity,
              rate: erpUnitRate(
                l.unitCostMinor,
                l.quantity,
                lineInputTax(l.quantity * l.unitCostMinor, l.gstRateBp),
                claimsInputTax(order),
              ),
              schedule_date: due,
              warehouse,
              uom: "Nos",
              stock_uom: "Nos",
              conversion_factor: 1,
            })),
            taxes,
          },
          `purchase-order:${order.id}`,
          true,
        );
      }
      await db.purchaseOrder.update({ where: { id: order.id, tenantId }, data: { erpnextName: name } });

      // Map ERPNext's rows (in the order we sent them) back to our lines.
      const doc = await this.client.call(env, ctx, {
        method: "GET",
        path: `/api/resource/Purchase Order/${encodeURIComponent(name)}`,
      });
      const rows = ((doc.body as { data?: { items?: Array<{ name: string; idx?: number }> } })?.data?.items ?? [])
        .slice()
        .sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0));
      if (rows.length !== order.lines.length) {
        throw new ErpError({
          kind: "validation_failed",
          message: `ERPNext Purchase Order ${name} has ${rows.length} rows; AMBURAX has ${order.lines.length}.`,
          correlationId,
        });
      }
      for (const [i, line] of order.lines.entries()) {
        await db.purchaseOrderLine.update({ where: { id: line.id }, data: { erpnextItemName: rows[i]!.name } });
      }
      await db.purchaseOrder.update({ where: { id: order.id, tenantId }, data: { erpSyncStatus: "SYNCED" } });
      return name;
    } catch (error) {
      await db.purchaseOrder.update({ where: { id: order.id, tenantId }, data: { erpSyncStatus: "FAILED" } });
      throw error;
    }
  }

  /** Cancel the ERPNext Purchase Order (docstatus 2). Nothing to do if it never reached ERPNext. */
  public async cancelOrder(tenantId: string, orderId: string, correlationId: string): Promise<void> {
    const order = await db.purchaseOrder.findUnique({ where: { id: orderId, tenantId } });
    if (!order) throw new Error(`Purchase order ${orderId} not found for tenant ${tenantId}`);
    const env = await requireErpEnvironment(tenantId, correlationId);
    const ctx = { tenantId, correlationId, causationId: order.id };
    const name =
      order.erpnextName ?? (await findDocumentName(this.client, env, ctx, "Purchase Order", "title", `${ORDER_REMARKS}${order.id}`));
    if (!name) return;
    await this.client.call(env, ctx, {
      method: "POST",
      path: "/api/method/frappe.client.cancel",
      body: { doctype: "Purchase Order", name },
      idempotencyKey: `purchase-order-cancel:${order.id}`,
    });
  }
}
