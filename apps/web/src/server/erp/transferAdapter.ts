import { db } from "@/server/db";
import type { ErpClient } from "@/server/erp/client";
import type { ErpEnvironment } from "@/server/erp/config";
import { ErpError } from "@/server/erp/errors";
import type { ErpTransport } from "@/server/erp/transport";
import {
  createDocument,
  erpDate,
  findDocumentName,
  newErpClient,
  requireErpEnvironment,
  requireCompany,
  assertWarehouseCompanyMatch,
} from "@/server/erp/documentSync";

type Step = "send" | "receive" | "shortfall" | "cancel";
const remarksFor = (step: Step, transferId: string) => `amburax-transfer-${step}:${transferId}`;

function loadTransfer(tenantId: string, transferId: string) {
  return db.stockTransfer.findUnique({
    where: { id: transferId, tenantId },
    include: {
      lines: true,
      fromStore: { select: { erpnextWarehouseId: true } },
      toStore: { select: { erpnextWarehouseId: true } },
    },
  });
}
type LoadedTransfer = NonNullable<Awaited<ReturnType<typeof loadTransfer>>>;

/**
 * AMBURAX store-to-store transfers → ERPNext Stock Entries through the company's transit
 * warehouse (warehouse_type "Transit", ERPNext's "Goods In Transit"). ERPNext is the master for
 * stock, so goods on the road sit in transit there too:
 *
 *   send     — Material Transfer: source store → transit
 *   receive  — Material Transfer: transit → destination, for what arrived
 *              + Material Issue from transit for any shortfall (written off, as AMBURAX does)
 *   cancel   — Material Transfer: transit → source
 *
 * Each step is idempotent through its own `remarks` stamp. A later step makes sure the send exists
 * first, so out-of-order delivery cannot move stock out of an empty transit warehouse.
 */
export class ErpTransferAdapter {
  private client: ErpClient;

  constructor(transport?: ErpTransport) {
    this.client = newErpClient(transport);
  }

  private async warehouses(
    env: ErpEnvironment,
    t: LoadedTransfer,
    correlationId: string
  ): Promise<{ from: string; to: string }> {
    const from = t.fromStore.erpnextWarehouseId;
    const to = t.toStore.erpnextWarehouseId;
    if (!from || !to) {
      throw new ErpError({
        kind: "configuration_error",
        message: `Transfer ${t.id}: a store has no ERP warehouse provisioned.`,
        correlationId,
      });
    }

    const company = requireCompany(env, correlationId);
    // Validate both source and destination warehouses against company
    await assertWarehouseCompanyMatch(this.client, env, { tenantId: t.tenantId, correlationId, causationId: t.id }, {
      storeId: t.fromStoreId,
      warehouseId: from,
      expectedCompany: company,
    });
    await assertWarehouseCompanyMatch(this.client, env, { tenantId: t.tenantId, correlationId, causationId: t.id }, {
      storeId: t.toStoreId,
      warehouseId: to,
      expectedCompany: company,
    });

    return { from, to };
  }

  private async transitWarehouse(env: ErpEnvironment, tenantId: string, correlationId: string): Promise<string> {
    const filters: unknown[] = [
      ["warehouse_type", "=", "Transit"],
      ["is_group", "=", 0],
    ];
    if (env.companyId) filters.push(["company", "=", env.companyId]);
    const path = `/api/resource/Warehouse?filters=${encodeURIComponent(JSON.stringify(filters))}&fields=${encodeURIComponent(
      JSON.stringify(["name"]),
    )}&limit_page_length=1`;
    const response = await this.client.call(env, { tenantId, correlationId }, { method: "GET", path });
    const name = (response.body as { data?: Array<{ name: string }> })?.data?.[0]?.name;
    if (!name) {
      throw new ErpError({
        kind: "configuration_error",
        message: "ERPNext has no transit warehouse for this company.",
        correlationId,
      });
    }
    return name;
  }

  private async entry(
    env: ErpEnvironment,
    tenantId: string,
    correlationId: string,
    t: LoadedTransfer,
    step: Step,
    purpose: "Material Transfer" | "Material Issue",
    at: Date,
    items: Array<{ variantId: string; qty: number; s?: string; t?: string }>,
  ): Promise<string | null> {
    const ctx = { tenantId, correlationId, causationId: t.id };
    const remarks = remarksFor(step, t.id);
    const found = await findDocumentName(this.client, env, ctx, "Stock Entry", "remarks", remarks);
    if (found) return found;
    const lines = items.filter((i) => i.qty > 0);
    if (lines.length === 0) return null;
    return createDocument(
      this.client,
      env,
      ctx,
      "Stock Entry",
      {
        stock_entry_type: purpose,
        purpose,
        company: env.companyId ?? undefined,
        posting_date: erpDate(at),
        set_posting_time: 1,
        remarks,
        items: lines.map((i) => ({
          item_code: i.variantId,
          qty: i.qty,
          uom: "Nos",
          stock_uom: "Nos",
          conversion_factor: 1,
          s_warehouse: i.s,
          t_warehouse: i.t,
        })),
      },
      `transfer-${step}:${t.id}`,
      true,
    );
  }

  private async ensureSent(env: ErpEnvironment, tenantId: string, correlationId: string, t: LoadedTransfer, transit: string) {
    if (t.erpnextSendEntry) return t.erpnextSendEntry;
    const { from } = await this.warehouses(env, t, correlationId);
    const name = await this.entry(
      env,
      tenantId,
      correlationId,
      t,
      "send",
      "Material Transfer",
      t.createdAt,
      t.lines.map((l) => ({ variantId: l.variantId, qty: l.quantity, s: from, t: transit })),
    );
    await db.stockTransfer.update({ where: { id: t.id, tenantId }, data: { erpnextSendEntry: name } });
    return name;
  }

  private async run(
    tenantId: string,
    transferId: string,
    correlationId: string,
    work: (env: ErpEnvironment, t: LoadedTransfer, transit: string) => Promise<void>,
  ): Promise<void> {
    const t = await loadTransfer(tenantId, transferId);
    if (!t) throw new Error(`Stock transfer ${transferId} not found for tenant ${tenantId}`);
    try {
      const env = await requireErpEnvironment(tenantId, correlationId);
      const transit = await this.transitWarehouse(env, tenantId, correlationId);
      await this.ensureSent(env, tenantId, correlationId, t, transit);
      await work(env, t, transit);
      await db.stockTransfer.update({ where: { id: t.id, tenantId }, data: { erpSyncStatus: "SYNCED" } });
    } catch (error) {
      await db.stockTransfer.update({ where: { id: t.id, tenantId }, data: { erpSyncStatus: "FAILED" } });
      throw error;
    }
  }

  public syncSent(tenantId: string, transferId: string, correlationId: string): Promise<void> {
    return this.run(tenantId, transferId, correlationId, async () => {});
  }

  public syncReceived(tenantId: string, transferId: string, correlationId: string): Promise<void> {
    return this.run(tenantId, transferId, correlationId, async (env, t, transit) => {
      const { to } = await this.warehouses(env, t, correlationId);
      const at = t.receivedAt ?? new Date();
      const received = await this.entry(
        env,
        tenantId,
        correlationId,
        t,
        "receive",
        "Material Transfer",
        at,
        t.lines.map((l) => ({ variantId: l.variantId, qty: l.receivedQuantity ?? 0, s: transit, t: to })),
      );
      await this.entry(
        env,
        tenantId,
        correlationId,
        t,
        "shortfall",
        "Material Issue",
        at,
        t.lines.map((l) => ({ variantId: l.variantId, qty: l.quantity - (l.receivedQuantity ?? 0), s: transit })),
      );
      if (received) {
        await db.stockTransfer.update({ where: { id: t.id, tenantId }, data: { erpnextReceiveEntry: received } });
      }
    });
  }

  public syncCancelled(tenantId: string, transferId: string, correlationId: string): Promise<void> {
    return this.run(tenantId, transferId, correlationId, async (env, t, transit) => {
      const { from } = await this.warehouses(env, t, correlationId);
      const back = await this.entry(
        env,
        tenantId,
        correlationId,
        t,
        "cancel",
        "Material Transfer",
        t.cancelledAt ?? new Date(),
        t.lines.map((l) => ({ variantId: l.variantId, qty: l.quantity, s: transit, t: from })),
      );
      if (back) {
        await db.stockTransfer.update({ where: { id: t.id, tenantId }, data: { erpnextReceiveEntry: back } });
      }
    });
  }
}
