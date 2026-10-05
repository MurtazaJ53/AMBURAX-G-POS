import { db } from "@/server/db";
import { ErpClient } from "@/server/erp/client";
import { resolveErpEnvironment, EnvErpCredentialProvider } from "@/server/erp/config";
import type { ErpEnvironment } from "@/server/erp/config";
import { HttpErpTransport } from "@/server/erp/httpTransport";
import { ErpError } from "@/server/erp/errors";
import type { ErpTransport } from "@/server/erp/transport";

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

  public async syncVariant(tenantId: string, variantId: string, correlationId: string): Promise<void> {
    const variant = await db.productVariant.findUnique({
      where: { id: variantId, tenantId },
      include: { product: true },
    });

    if (!variant) return;

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

    const itemPayload = {
      item_code: variant.id,
      item_name: itemName,
      item_group: variant.product.category || "Products",
      stock_uom: "Nos", // Default Frappe UOM
      standard_rate: variant.priceMinor / 100,
      is_stock_item: 1,
      is_sales_item: 1,
      disabled: variant.isActive ? 0 : 1,
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
        // CREATE
        await this.client.call(
          env,
          { tenantId, correlationId, causationId: variantId },
          {
            method: "POST",
            path: "/api/resource/Item",
            body: itemPayload,
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
