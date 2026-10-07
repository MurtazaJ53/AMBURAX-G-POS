import { db } from "@/server/db";
import { ErpClient } from "@/server/erp/client";
import { resolveErpEnvironment, EnvErpCredentialProvider } from "@/server/erp/config";
import type { ErpEnvironment } from "@/server/erp/config";
import { HttpErpTransport } from "@/server/erp/httpTransport";
import { ErpError } from "@/server/erp/errors";
import type { ErpTransport } from "@/server/erp/transport";

/**
 * The remarks prefix AMBURAX stamps on every Stock Entry it creates.
 * This is the idempotency token: on a re-delivery we filter by this prefix
 * and the movement id.  `remarks` is a standard Frappe/ERPNext field that
 * does not require a custom field definition.
 */
const REMARKS_PREFIX = "amburax-movement-id:";

function buildRemarks(movementId: string): string {
  return `${REMARKS_PREFIX}${movementId}`;
}

export class ErpInventoryAdapter {
  private client: ErpClient;

  constructor(transport?: ErpTransport) {
    this.client = new ErpClient(
      transport ?? new HttpErpTransport(),
      new EnvErpCredentialProvider(),
      {}
    );
  }

  /**
   * Check whether we already created a Stock Entry for this movement.
   * Uses the standard `remarks` field so no custom DocType field is required.
   *
   * Idempotency contract:
   *   - First delivery: lookup returns null → we POST → one Stock Entry.
   *   - Re-delivery: lookup returns the name → we return early → no duplicate.
   *
   * The window between lookup and POST is tolerated:
   *   - The outbox worker processes events serially per idempotency key.
   *   - A duplicate would carry the same remarks value, so a second lookup
   *     would catch it on the very next attempt.
   */
  private async lookupStockEntryByMovementId(
    env: ErpEnvironment,
    tenantId: string,
    movementId: string,
    correlationId: string
  ): Promise<string | null> {
    const remarks = buildRemarks(movementId);
    const filters = JSON.stringify([["remarks", "=", remarks]]);
    const fields = JSON.stringify(["name", "remarks"]);

    const path = `/api/resource/Stock Entry?filters=${encodeURIComponent(filters)}&fields=${encodeURIComponent(fields)}`;

    const response = await this.client.call(
      env,
      { tenantId, correlationId, causationId: movementId },
      { method: "GET", path }
    );

    const body = response.body as { data?: Array<{ name: string; remarks: string }> };
    const data = body?.data;

    if (!Array.isArray(data) || data.length === 0) {
      return null;
    }

    // More than one: this should never happen because remarks contains the movement id,
    // but if ERPNext somehow has duplicates we throw rather than silently picking one.
    if (data.length === 1) {
      return data[0]?.name ?? null;
    }

    throw new ErpError({
      kind: "validation_failed",
      message: `Multiple Stock Entries found for movement ${movementId}`,
      correlationId,
    });
  }

  /**
   * Sync one local StockMovement to ERPNext as a submitted Stock Entry.
   *
   * - Positive quantityDelta → Material Receipt (t_warehouse)
   * - Negative quantityDelta → Material Issue (s_warehouse)
   *
   * Idempotent: a second call for the same movementId returns without creating
   * a second Stock Entry.
   *
   * Tenant isolation: the movement is fetched with `{ id, tenantId }` so a
   * movement belonging to another tenant produces "not found" rather than
   * crossing a boundary.
   */
  public async syncMovement(
    tenantId: string,
    movementId: string,
    correlationId: string
  ): Promise<void> {
    const movement = await db.stockMovement.findUnique({
      where: { id: movementId, tenantId },
      include: {
        store: true,
        variant: {
          include: { product: true },
        },
      },
    });

    if (!movement) {
      // Movement does not exist or belongs to another tenant — treat both the same way.
      throw new Error(`Stock movement ${movementId} not found for tenant ${tenantId}`);
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

    // ── Idempotency guard ────────────────────────────────────────────────────
    const existingEntryName = await this.lookupStockEntryByMovementId(
      env,
      tenantId,
      movement.id,
      correlationId
    );

    if (existingEntryName) {
      // Already synced — this is a safe no-op.
      return;
    }

    // ── Dependency validation ────────────────────────────────────────────────
    if (!movement.store.erpnextWarehouseId) {
      throw new ErpError({
        kind: "configuration_error",
        message: `Store ${movement.storeId} has no ERP warehouse provisioned. Cannot sync stock movement.`,
        correlationId,
      });
    }

    const warehouseId = movement.store.erpnextWarehouseId;
    // The AMBURAX variantId is used as the ERPNext item_code (established by catalogAdapter).
    const itemCode = movement.variantId;
    const quantity = Math.abs(movement.quantityDelta);
    const isPositive = movement.quantityDelta > 0;

    // Positive → incoming stock: Material Receipt → t_warehouse
    // Negative → outgoing stock: Material Issue   → s_warehouse
    const purpose = isPositive ? "Material Receipt" : "Material Issue";

    const stockEntryDoc: Record<string, unknown> = {
      doctype: "Stock Entry",
      purpose,
      // Embed the movement id in remarks so idempotency lookup works on re-delivery.
      remarks: buildRemarks(movement.id),
      company: env.companyId ?? "Amburax Retail",
      items: [
        {
          item_code: itemCode,
          qty: quantity,
          uom: "Nos",
          stock_uom: "Nos",
          t_warehouse: isPositive ? warehouseId : undefined,
          s_warehouse: isPositive ? undefined : warehouseId,
        },
      ],
    };

    // ── Create the Stock Entry (Draft) ───────────────────────────────────────
    const createResponse = await this.client.call(
      env,
      { tenantId, correlationId, causationId: movement.id },
      {
        method: "POST",
        path: "/api/resource/Stock Entry",
        body: stockEntryDoc,
        idempotencyKey: movement.id,
      }
    );

    if (createResponse.status !== 200 && createResponse.status !== 201) {
      throw new ErpError({
        kind: "server_error",
        message: `Failed to create Stock Entry: HTTP ${createResponse.status}`,
        correlationId,
      });
    }

    // ── Submit the Stock Entry ───────────────────────────────────────────────
    const createdName = (createResponse.body as { data?: { name?: string } })?.data?.name;

    if (createdName) {
      await this.client.call(
        env,
        { tenantId, correlationId, causationId: movement.id },
        {
          method: "PUT",
          path: `/api/resource/Stock Entry/${encodeURIComponent(createdName)}`,
          body: { docstatus: 1 },
        }
      );
    }
  }
}
