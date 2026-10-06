import { db } from "@/server/db";
import { ErpClient } from "@/server/erp/client";
import { resolveErpEnvironment, EnvErpCredentialProvider } from "@/server/erp/config";
import { HttpErpTransport } from "@/server/erp/httpTransport";
import type { ErpTransport } from "@/server/erp/transport";
import { ErpError } from "./errors";

export class ErpStoreAdapter {
  private client: ErpClient;

  constructor(transport?: ErpTransport) {
    this.client = new ErpClient(
      transport ?? new HttpErpTransport(),
      new EnvErpCredentialProvider()
    );
  }

  public async syncStore(tenantId: string, storeId: string, correlationId: string): Promise<void> {
    const store = await db.store.findUnique({
      where: { id: storeId, tenantId },
    });

    if (!store) return;

    if (store.erpnextProvisionStatus === "PROVISIONED" && store.erpnextWarehouseId) {
      return;
    }

    const envResult = await resolveErpEnvironment(tenantId);
    
    if (envResult.status !== "ok") {
      await db.store.update({
        where: { id: store.id },
        data: { erpnextProvisionStatus: "FAILED" },
      });
      throw new ErpError({
        kind: "configuration_error",
        message: `ERP environment not provisioned for tenant ${tenantId}. Status: ${envResult.status}`,
        correlationId,
      });
    }

    const env = envResult.environment;
    const company = env.companyId || "Amburax Retail";

    await db.store.update({
      where: { id: store.id },
      data: { erpnextProvisionStatus: "PROVISIONING" },
    });

    try {
      // Deterministic warehouse identity
      const warehouseName = `${store.name} (${store.code})`;

      // 1. Lookup existing warehouse (Idempotency)
      const lookupResponse = await this.client.call(
        env,
        { tenantId, correlationId, causationId: storeId },
        {
          method: "GET",
          path: `/api/resource/Warehouse?filters=[["warehouse_name","=","${warehouseName}"],["company","=","${company}"]]&fields=["name"]`,
        }
      );

      let erpnextWarehouseId: string;
      const data = (lookupResponse.body as any)?.data as Array<{ name: string }>;

      if (data && data.length > 0) {
        erpnextWarehouseId = data[0]!.name;
      } else {
        // 2. Create if not found
        try {
          const createResponse = await this.client.call(
            env,
            { tenantId, correlationId, causationId: storeId },
            {
              method: "POST",
              path: "/api/resource/Warehouse",
              body: {
                warehouse_name: warehouseName,
                company: company,
                is_group: 0,
              },
            }
          );
          erpnextWarehouseId = (createResponse.body as any)?.data?.name;
        } catch (createError: any) {
          // 409 Conflict could happen if it was created concurrently
          if (createError instanceof ErpError && createError.message.includes("409")) { // client.call throws ErpError on non-2xx
            // Re-lookup
            const retryLookup = await this.client.call(
              env,
              { tenantId, correlationId, causationId: storeId },
              {
                method: "GET",
                path: `/api/resource/Warehouse?filters=[["warehouse_name","=","${warehouseName}"],["company","=","${company}"]]&fields=["name"]`,
              }
            );
            const retryData = (retryLookup.body as any)?.data as Array<{ name: string }>;
            if (retryData && retryData.length > 0) {
              erpnextWarehouseId = retryData[0]!.name;
            } else {
              throw new ErpError({
                kind: "unavailable",
                message: "Warehouse creation conflict, but re-lookup failed",
                correlationId,
              });
            }
          } else {
            throw createError;
          }
        }
      }

      // 3. Mark as PROVISIONED
      await db.store.update({
        where: { id: store.id },
        data: {
          erpnextProvisionStatus: "PROVISIONED",
          erpnextWarehouseId,
        },
      });
    } catch (error) {
      await db.store.update({
        where: { id: store.id },
        data: { erpnextProvisionStatus: "FAILED" },
      });
      throw error;
    }
  }
}
