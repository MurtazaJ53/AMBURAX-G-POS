import { db } from "@/server/db";
import type { ErpClient } from "@/server/erp/client";
import { ErpError } from "@/server/erp/errors";
import type { ErpTransport } from "@/server/erp/transport";
import {
  createDocument,
  erpDate,
  erpText,
  findDocumentName,
  newErpClient,
  requireErpEnvironment,
} from "@/server/erp/documentSync";

const REQUEST_REMARKS = "amburax-replenishment-id:";

type ReorderRow = {
  warehouse: string;
  warehouse_reorder_level?: number;
  warehouse_reorder_qty?: number;
  material_request_type?: string;
};

/**
 * Screen 32 → ERPNext.
 *
 *   reorder rule → the Item's `reorder_levels` row for the store's warehouse (Item Reorder);
 *                  other warehouses' rows are left exactly as ERPNext has them
 *   request      → a draft Material Request, type Purchase, for the store's warehouse
 */
export class ErpReplenishmentAdapter {
  private client: ErpClient;

  constructor(transport?: ErpTransport) {
    this.client = newErpClient(transport);
  }

  private async warehouseOf(tenantId: string, storeId: string, correlationId: string): Promise<string> {
    const store = await db.store.findUnique({ where: { id: storeId, tenantId }, select: { erpnextWarehouseId: true } });
    if (!store?.erpnextWarehouseId) {
      throw new ErpError({
        kind: "configuration_error",
        message: `Store ${storeId} has no ERP warehouse provisioned.`,
        correlationId,
      });
    }
    return store.erpnextWarehouseId;
  }

  public async syncRule(tenantId: string, storeId: string, variantId: string, correlationId: string): Promise<void> {
    const rule = await db.reorderRule.findUnique({
      where: { tenantId_storeId_variantId: { tenantId, storeId, variantId } },
    });
    try {
      const env = await requireErpEnvironment(tenantId, correlationId);
      const ctx = { tenantId, correlationId, causationId: variantId };
      const warehouse = await this.warehouseOf(tenantId, storeId, correlationId);
      const path = `/api/resource/Item/${encodeURIComponent(variantId)}`;
      const item = await this.client.call(env, ctx, { method: "GET", path });
      const current = (item.body as { data?: { reorder_levels?: ReorderRow[] } })?.data?.reorder_levels ?? [];
      const others = current
        .filter((r) => r.warehouse !== warehouse)
        .map((r) => ({
          warehouse: r.warehouse,
          warehouse_reorder_level: r.warehouse_reorder_level,
          warehouse_reorder_qty: r.warehouse_reorder_qty,
          material_request_type: r.material_request_type,
        }));
      const mine: ReorderRow[] = rule
        ? [
            {
              warehouse,
              warehouse_reorder_level: rule.reorderLevel,
              warehouse_reorder_qty: rule.reorderQty,
              material_request_type: "Purchase",
            },
          ]
        : [];
      await this.client.call(env, ctx, {
        method: "PUT",
        path,
        body: { reorder_levels: [...others, ...mine] },
        idempotencyKey: `reorder:${storeId}:${variantId}:${rule?.updatedAt.getTime() ?? "cleared"}`,
      });
      if (rule) {
        await db.reorderRule.update({ where: { id: rule.id }, data: { erpSyncStatus: "SYNCED" } });
      }
    } catch (error) {
      if (rule) await db.reorderRule.update({ where: { id: rule.id }, data: { erpSyncStatus: "FAILED" } });
      throw error;
    }
  }

  public async syncRequest(tenantId: string, requestId: string, correlationId: string): Promise<string> {
    const request = await db.replenishmentRequest.findUnique({
      where: { id: requestId, tenantId },
      include: { lines: true },
    });
    if (!request) throw new Error(`Replenishment request ${requestId} not found for tenant ${tenantId}`);
    if (request.erpSyncStatus === "SYNCED" && request.erpnextName) return request.erpnextName;

    try {
      const env = await requireErpEnvironment(tenantId, correlationId);
      const ctx = { tenantId, correlationId, causationId: request.id };
      const stamp = `${REQUEST_REMARKS}${request.id}`;
      // Material Request has no `remarks`; its `title` is a Data field that carries the stamp.
      let name = await findDocumentName(this.client, env, ctx, "Material Request", "title", stamp);
      if (!name) {
        const warehouse = await this.warehouseOf(tenantId, request.storeId, correlationId);
        const date = erpDate(request.createdAt);
        name = await createDocument(
          this.client,
          env,
          ctx,
          "Material Request",
          {
            title: stamp,
            material_request_type: "Purchase",
            company: env.companyId ?? undefined,
            transaction_date: date,
            schedule_date: date,
            set_warehouse: warehouse,
            items: request.lines.map((l) => ({
              item_code: l.variantId,
              qty: l.quantity,
              warehouse,
              schedule_date: date,
              uom: "Nos",
              stock_uom: "Nos",
              conversion_factor: 1,
              description: erpText(request.note),
            })),
          },
          `replenishment:${request.id}`,
          false,
        );
      }
      await db.replenishmentRequest.update({
        where: { id: request.id, tenantId },
        data: { erpnextName: name, erpSyncStatus: "SYNCED" },
      });
      return name;
    } catch (error) {
      await db.replenishmentRequest.update({ where: { id: request.id, tenantId }, data: { erpSyncStatus: "FAILED" } });
      throw error;
    }
  }
}
