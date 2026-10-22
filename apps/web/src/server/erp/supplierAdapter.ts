import { db } from "@/server/db";
import type { ErpClient } from "@/server/erp/client";
import type { ErpTransport } from "@/server/erp/transport";
import {
  createDocument,
  erpText,
  findDocumentName,
  newErpClient,
  requireErpEnvironment,
} from "@/server/erp/documentSync";

/**
 * AMBURAX Supplier → ERPNext Supplier. ERPNext is the master for suppliers; AMBURAX keeps the
 * mapping (`erpnextName`) so purchase receipts can name the supplier ERPNext knows.
 *
 * Idempotent: the mapping is checked first, then ERPNext is searched by `supplier_name` (unique
 * per tenant in AMBURAX, and ERPNext's default naming), so a crash between create and saving the
 * mapping never makes a second supplier.
 */
export class ErpSupplierAdapter {
  private client: ErpClient;

  constructor(transport?: ErpTransport) {
    this.client = newErpClient(transport);
  }

  public async syncSupplier(tenantId: string, supplierId: string, correlationId: string): Promise<string> {
    const supplier = await db.supplier.findUnique({ where: { id: supplierId, tenantId } });
    if (!supplier) throw new Error(`Supplier ${supplierId} not found for tenant ${tenantId}`);

    try {
      const env = await requireErpEnvironment(tenantId, correlationId);
      const ctx = { tenantId, correlationId, causationId: supplier.id };
      const supplierName = erpText(supplier.name) ?? supplier.id;
      const fields: Record<string, unknown> = {
        supplier_name: supplierName,
        tax_id: erpText(supplier.gstin, 15),
        mobile_no: erpText(supplier.phone),
        email_id: erpText(supplier.email),
        disabled: supplier.isActive ? 0 : 1,
        // Always the company's currency, so the supplier's payable account matches the purchase
        // receipt and the bill can never be refused for a currency mismatch.
        default_currency: "INR",
      };

      const existing =
        supplier.erpnextName ?? (await findDocumentName(this.client, env, ctx, "Supplier", "supplier_name", supplierName));

      let name: string;
      if (existing) {
        await this.client.call(env, ctx, {
          method: "PUT",
          path: `/api/resource/Supplier/${encodeURIComponent(existing)}`,
          body: fields,
        });
        name = existing;
      } else {
        name = await createDocument(
          this.client,
          env,
          ctx,
          "Supplier",
          { ...fields, supplier_group: "All Supplier Groups", supplier_type: "Company", country: "India" },
          `supplier:${supplier.id}`,
          false,
        );
      }

      await db.supplier.update({
        where: { id: supplier.id, tenantId },
        data: { erpnextName: name, erpSyncStatus: "SYNCED" },
      });
      return name;
    } catch (error) {
      await db.supplier.update({ where: { id: supplier.id, tenantId }, data: { erpSyncStatus: "FAILED" } });
      throw error;
    }
  }
}
