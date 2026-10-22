import { db } from "@/server/db";
import { ErpClient, type ErpCallContext } from "@/server/erp/client";
import { resolveErpEnvironment, EnvErpCredentialProvider, type ErpEnvironment } from "@/server/erp/config";
import { requireCompany } from "@/server/erp/documentSync";
import { HttpErpTransport } from "@/server/erp/httpTransport";
import type { ErpTransport } from "@/server/erp/transport";
import { ErpError } from "./errors";

/**
 * Store -> ERPNext Warehouse (ADR-077: Store 1:1 Warehouse, inside the business's one Company).
 *
 * A store created before its business is connected to ERPNext is not an error: it waits as
 * NOT_PROVISIONED, and tenant provisioning queues every waiting store again once the Company exists.
 */
export class ErpStoreAdapter {
  private client: ErpClient;

  constructor(transport?: ErpTransport) {
    this.client = new ErpClient(transport ?? new HttpErpTransport(), new EnvErpCredentialProvider());
  }

  private async findWarehouse(env: ErpEnvironment, ctx: ErpCallContext, warehouseName: string, company: string) {
    // Filters as encoded JSON: a store name with a quote or bracket must not change the query.
    const filters = encodeURIComponent(JSON.stringify([["warehouse_name", "=", warehouseName], ["company", "=", company]]));
    const fields = encodeURIComponent(JSON.stringify(["name"]));
    const res = await this.client.call(env, ctx, { method: "GET", path: `/api/resource/Warehouse?filters=${filters}&fields=${fields}` });
    const data = (res.body as { data?: Array<{ name: string }> })?.data;
    return Array.isArray(data) && data.length > 0 ? data[0]!.name : null;
  }

  public async syncStore(tenantId: string, storeId: string, correlationId: string): Promise<void> {
    const store = await db.store.findUnique({ where: { id: storeId, tenantId } });
    if (!store) return;
    if (store.erpnextProvisionStatus === "PROVISIONED" && store.erpnextWarehouseId) return;

    const envResult = await resolveErpEnvironment(tenantId);
    if (envResult.status !== "ok") {
      // Not connected yet: wait. Provisioning re-queues this store when the Company exists.
      await db.store.update({ where: { id: store.id }, data: { erpnextProvisionStatus: "NOT_PROVISIONED" } });
      return;
    }
    const env = envResult.environment;
    const company = requireCompany(env, correlationId);
    const ctx = { tenantId, correlationId, causationId: storeId };

    await db.store.update({ where: { id: store.id }, data: { erpnextProvisionStatus: "PROVISIONING" } });

    try {
      // Deterministic warehouse identity, so a retry finds what the first attempt made.
      const warehouseName = `${store.name} (${store.code})`;
      let erpnextWarehouseId = await this.findWarehouse(env, ctx, warehouseName, company);

      if (!erpnextWarehouseId) {
        try {
          const created = await this.client.call(env, ctx, {
            method: "POST",
            path: "/api/resource/Warehouse",
            body: { warehouse_name: warehouseName, company, is_group: 0 },
          });
          erpnextWarehouseId = (created.body as { data?: { name?: string } })?.data?.name ?? null;
        } catch (createError) {
          // Created concurrently by another delivery: find it instead of failing.
          if (createError instanceof ErpError && createError.kind === "conflict") {
            erpnextWarehouseId = await this.findWarehouse(env, ctx, warehouseName, company);
          } else {
            throw createError;
          }
        }
      }
      if (!erpnextWarehouseId) {
        throw new ErpError({ kind: "unavailable", message: "ERPNext did not return the warehouse it created.", correlationId });
      }

      await db.store.update({
        where: { id: store.id },
        data: { erpnextProvisionStatus: "PROVISIONED", erpnextWarehouseId },
      });
    } catch (error) {
      await db.store.update({ where: { id: store.id }, data: { erpnextProvisionStatus: "FAILED" } });
      throw error;
    }
  }
}
