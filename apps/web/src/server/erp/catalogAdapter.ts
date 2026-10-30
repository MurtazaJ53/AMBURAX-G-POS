import { db } from "@/server/db";
import { ErpClient } from "@/server/erp/client";
import { resolveErpEnvironment, EnvErpCredentialProvider } from "@/server/erp/config";
import type { ErpEnvironment } from "@/server/erp/config";
import { HttpErpTransport } from "@/server/erp/httpTransport";
import { ErpError } from "@/server/erp/errors";
import { GstTaxTreatment } from "@prisma/client";
import type { ErpTransport } from "@/server/erp/transport";

/** ERPNext's stock Item Group, present on every site. */
const DEFAULT_ITEM_GROUP = "Products";

export class ErpCatalogAdapter {
  private client: ErpClient;

  constructor(transport?: ErpTransport) {
    this.client = new ErpClient(
      transport ?? new HttpErpTransport(),
      new EnvErpCredentialProvider(),
      {}
    );
  }

  private async lookupItem(
    env: ErpEnvironment,
    tenantId: string,
    variantId: string,
    correlationId: string
  ): Promise<string | null> {
    const path = `/api/resource/Item/${encodeURIComponent(variantId)}`;

    try {
      const response = await this.client.call(
        env,
        { tenantId, correlationId, causationId: variantId },
        {
          method: "GET",
          path,
        }
      );

      if (response.status === 200) {
        const body = response.body as { data?: { name?: string } };
        return body.data?.name ?? null;
      }
      return null;
    } catch (error) {
      if (error instanceof ErpError && error.kind === "not_found") {
        return null;
      }
      throw error;
    }
  }

  /**
   * ERPNext refuses an Item whose Item Group doesn't exist (HTTP 417). AMBURAX categories are free
   * text, so use the category only when ERPNext already has that group; otherwise the stock
   * "Products" group. Creating groups would need the integration role widened (owner approval).
   */
  private async resolveItemGroup(
    env: ErpEnvironment,
    tenantId: string,
    category: string | null,
    variantId: string,
    correlationId: string
  ): Promise<string> {
    const wanted = category?.trim();
    if (!wanted || wanted === DEFAULT_ITEM_GROUP) return DEFAULT_ITEM_GROUP;
    try {
      const response = await this.client.call(
        env,
        { tenantId, correlationId, causationId: variantId },
        { method: "GET", path: `/api/resource/Item Group/${encodeURIComponent(wanted)}` }
      );
      const name = (response.body as { data?: { name?: string } })?.data?.name;
      return name ?? DEFAULT_ITEM_GROUP;
    } catch (error) {
      if (error instanceof ErpError && error.kind === "not_found") return DEFAULT_ITEM_GROUP;
      throw error;
    }
  }

  public async syncVariant(tenantId: string, variantId: string, correlationId: string): Promise<void> {
    const variant = await db.productVariant.findUnique({
      where: { id: variantId, tenantId },
      include: { product: true },
    });

    if (!variant) return;

    // Every decided GST type syncs (owner B3, 2026-10-16). EXEMPT / NIL_RATED are flagged
    // "nil rated or exempted" and NON_GST "non-GST" on the ERPNext Item (India Compliance fields;
    // ERPNext ignores them where India Compliance isn't installed).
    const tenant = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { taxId: true },
    });
    const isGstShop = Boolean(tenant?.taxId?.trim());

    let everTurnedOnGst = false;
    if (!isGstShop && variant.taxTreatment === GstTaxTreatment.UNSPECIFIED) {
      const gstAudit = await db.auditLog.findFirst({
        where: { tenantId, action: "tenant.gst_registered" },
        select: { id: true },
      });
      everTurnedOnGst = Boolean(gstAudit);
    }

    // UNSPECIFIED is refused for GST-registered shops and tenants that have ever registered for GST.
    if (variant.taxTreatment === GstTaxTreatment.UNSPECIFIED && (isGstShop || everTurnedOnGst)) {
      await db.productVariant.update({
        where: { id: variantId, tenantId },
        data: { erpSyncStatus: "FAILED" },
      });
      throw new ErpError({
        kind: "validation_failed",
        message: `ERP catalog sync does not support tax treatment ${variant.taxTreatment}. Resolve the classification and configure a reviewed ERP tax mapping.`,
        correlationId,
      });
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

    const itemNameParts = [variant.product.name, variant.size, variant.colour].filter(Boolean);
    const itemName = itemNameParts.join(" - ") || variant.product.name;

    // ERPNext stores `image` as a URL it can open. A relative /uploads path points at AMBURAX, not
    // ERPNext, so only an absolute http(s) address is sent.
    const imageUrl = variant.product.imageUrl;
    const hsn = variant.product.hsnCode?.trim();
    const isNonGstItem =
      variant.taxTreatment === GstTaxTreatment.NON_GST ||
      (!isGstShop && variant.taxTreatment === GstTaxTreatment.UNSPECIFIED);

    const itemPayload: Record<string, unknown> = {
      item_code: variant.id,
      item_name: itemName,
      stock_uom: "Nos", // Default Frappe UOM
      standard_rate: variant.priceMinor / 100,
      is_stock_item: 1,
      is_sales_item: 1,
      disabled: variant.isActive ? 0 : 1,
      is_nil_exempt:
        variant.taxTreatment === GstTaxTreatment.EXEMPT || variant.taxTreatment === GstTaxTreatment.NIL_RATED ? 1 : 0,
      is_non_gst: isNonGstItem ? 1 : 0,
      ...(!isNonGstItem && hsn ? { gst_hsn_code: hsn } : {}),
      image: imageUrl && /^https?:\/\//i.test(imageUrl) ? imageUrl : null,
    };

    const existingName = await this.lookupItem(env, tenantId, variantId, correlationId);

    try {
      if (existingName) {
        // UPDATE
        await this.client.call(
          env,
          { tenantId, correlationId, causationId: variantId },
          {
            method: "PUT",
            path: `/api/resource/Item/${encodeURIComponent(existingName)}`,
            body: itemPayload,
          }
        );
      } else {
        // CREATE. The Item Group is set only here: once the item exists ERPNext owns its grouping,
        // so updates never overwrite a group an accountant chose there.
        const itemGroup = await this.resolveItemGroup(env, tenantId, variant.product.category, variantId, correlationId);
        await this.client.call(
          env,
          { tenantId, correlationId, causationId: variantId },
          {
            method: "POST",
            path: "/api/resource/Item",
            body: { ...itemPayload, item_group: itemGroup },
          }
        );
      }

      await db.productVariant.update({
        where: { id: variantId, tenantId },
        data: { erpSyncStatus: "SYNCED" },
      });
    } catch (error) {
      await db.productVariant.update({
        where: { id: variantId, tenantId },
        data: { erpSyncStatus: "FAILED" },
      });
      throw error;
    }
  }
}
