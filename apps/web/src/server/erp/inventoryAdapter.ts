import { db } from "@/server/db";
import { requireCompany, assertWarehouseCompanyMatch } from "@/server/erp/documentSync";
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

    if (data.length === 1) {
      return data[0]?.name ?? null;
    }

    // Defensive: multiple Stock Entries share the exact same movement remarks token.
    // This is an unrecoverable invariant violation that requires operator inspection.
    throw new ErpError({
      kind: "validation_failed",
      message: `Multiple Stock Entries found for movement ${movementId} with remarks "${remarks}". Manual intervention required.`,
      correlationId,
    });
  }

  /**
   * Synchronize a single Stock Movement to an ERPNext Stock Entry document.
   *
   * Invariant rules:
   *   1. Exactly one Stock Entry per AMBURAX StockMovement record (idempotency key: `remarks`).
   *   2. Positive delta (+N) → incoming stock → purpose "Material Receipt" → target `t_warehouse`.
   *   3. Negative delta (-N) → outgoing stock → purpose "Material Issue"   → source `s_warehouse`.
   *   4. Quantity must be non-zero (zero-delta movements are a business logic error).
   *   5. Submits the Stock Entry (`docstatus: 1`) so that ERPNext stock ledger entries are posted.
   *   6. On retry after failure: checks for existing Stock Entry before attempting creation.
   *   7. Requires a provisioned store with `erpnextWarehouseId` set.
   *   8. Opening Stock valuation:
   *      - unitCostMinor > 0 → valuation_rate = unitCostMinor / 100
   *      - unitCostMinor === 0 AND isFreeSample === true → valuation_rate = 0, allow_zero_valuation_rate = 1
   *      - unitCostMinor === 0 AND isFreeSample === false → REJECT with 422 MISSING_OPENING_COST
   *   9. Step 5b Guard: Store warehouse must belong to tenant company (fail-closed).
   */
  public async syncMovement(tenantId: string, movementId: string, correlationId: string): Promise<void> {
    const movement = await db.stockMovement.findUnique({
      where: { id: movementId, tenantId },
      include: {
        store: true,
        variant: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!movement) {
      throw new Error(`Stock movement ${movementId} not found`);
    }

    if (movement.quantityDelta === 0) {
      // Invariant violation: movements with 0 delta should not be created.
      // This is a permanent validation failure — dead-letter immediately.
      throw new ErpError({
        kind: "validation_failed",
        message: `Stock movement ${movementId} has quantityDelta of 0. Cannot sync zero-quantity movement.`,
        correlationId,
      });
    }

    // ── Pre-flight: Check ERP environment provision status ───────────────────
    const envResult = await resolveErpEnvironment(tenantId);
    if (envResult.status !== "ok") {
      throw new ErpError({
        kind: "configuration_error",
        message: `ERP environment not provisioned for tenant ${tenantId}. Status: ${envResult.status}`,
        correlationId,
      });
    }
    const env = envResult.environment;

    // ── Idempotency Check ────────────────────────────────────────────────────
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

    // ── Dependency validation & Cross-Tenant Guard ────────────────────────────
    const company = requireCompany(env, correlationId);
    await assertWarehouseCompanyMatch(this.client, env, { tenantId, correlationId, causationId: movement.id }, {
      storeId: movement.storeId,
      warehouseId: movement.store.erpnextWarehouseId,
      expectedCompany: company,
    });

    const warehouseId = movement.store.erpnextWarehouseId!;

    // The AMBURAX variantId is used as the ERPNext item_code (established by catalogAdapter).
    const itemCode = movement.variantId;
    const quantity = Math.abs(movement.quantityDelta);
    const isPositive = movement.quantityDelta > 0;

    // Positive → incoming stock: Material Receipt → t_warehouse
    // Negative → outgoing stock: Material Issue   → s_warehouse
    const purpose = isPositive ? "Material Receipt" : "Material Issue";

    // ── Valuation Rate & Free Sample Logic ───────────────────────────────────
    let valuationRate: number | undefined;
    let allowZeroValuationRate: number | undefined;

    if (isPositive) {
      if (movement.unitCostMinor != null && movement.unitCostMinor > 0) {
        valuationRate = movement.unitCostMinor / 100;
      } else if (movement.isFreeSample) {
        valuationRate = 0;
        allowZeroValuationRate = 1;
      } else {
        // Enforce strict zero cost rejection
        throw new ErpError({
          kind: "validation_failed",
          message: `Stock movement ${movementId} has zero or missing unit cost without isFreeSample flag. Cannot sync stock movement.`,
          correlationId,
        });
      }
    }

    // Build line item
    const lineItem: Record<string, unknown> = {
      item_code: itemCode,
      qty: quantity,
      uom: "Nos",
      stock_uom: "Nos",
      conversion_factor: 1,
      ...(isPositive ? { t_warehouse: warehouseId } : { s_warehouse: warehouseId }),
      ...(valuationRate !== undefined ? { basic_rate: valuationRate } : {}),
      ...(allowZeroValuationRate !== undefined ? { allow_zero_valuation_rate: allowZeroValuationRate } : {}),
    };

    const stockEntryDoc: Record<string, unknown> = {
      doctype: "Stock Entry",
      purpose,
      stock_entry_type: purpose,
      company,
      posting_date: new Date().toISOString().split("T")[0],
      remarks: buildRemarks(movement.id),
      docstatus: 1, // Submit immediately
      items: [lineItem],
    };

    const response = await this.client.call(
      env,
      { tenantId, correlationId, causationId: movement.id },
      {
        method: "POST",
        path: "/api/resource/Stock Entry",
        body: stockEntryDoc,
        idempotencyKey: `stock-entry:${movement.id}`,
      }
    );

    if (response.status !== 200 && response.status !== 201) {
      throw new ErpError({
        kind: "server_error",
        message: `Failed to create Stock Entry: HTTP ${response.status}`,
        correlationId,
      });
    }

    const created = response.body as { data?: { name: string } };
    if (!created?.data?.name) {
      throw new ErpError({
        kind: "malformed_response",
        message: `ERPNext created Stock Entry but did not return document name for movement ${movement.id}`,
        correlationId,
      });
    }
  }
}
