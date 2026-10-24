import { ErpClient, type ErpCallContext } from "@/server/erp/client";
import { resolveErpEnvironment, EnvErpCredentialProvider, type ErpEnvironment } from "@/server/erp/config";
import { HttpErpTransport } from "@/server/erp/httpTransport";
import type { ErpTransport } from "@/server/erp/transport";

export interface NegativeStockLine {
  itemCode: string;
  itemName: string;
  warehouse: string;
  qty: number;
}

/**
 * Read-only: every item/warehouse of this company whose ERPNext stock (Bin.actual_qty) is below
 * zero, most negative first. POS shops sell with allow_negative_stock on, so this is how the owner
 * learns that stock was sold before it was received. `null` when not connected to ERPNext.
 */
export class ErpNegativeStockReader {
  private client: ErpClient;

  constructor(transport?: ErpTransport) {
    this.client = new ErpClient(transport ?? new HttpErpTransport(), new EnvErpCredentialProvider(), {});
  }

  async listNegativeStock(tenantId: string, correlationId: string): Promise<NegativeStockLine[] | null> {
    const envResult = await resolveErpEnvironment(tenantId);
    if (envResult.status !== "ok" || !envResult.environment.companyId) return null;
    const env = envResult.environment;
    const ctx: ErpCallContext = { tenantId, correlationId, causationId: tenantId };

    const warehouses = await this.list<{ name: string }>(env, ctx, "Warehouse", [["company", "=", env.companyId]], ["name"]);
    if (warehouses.length === 0) return [];

    const bins = await this.list<{ item_code: string; warehouse: string; actual_qty: number }>(
      env,
      ctx,
      "Bin",
      [
        ["warehouse", "in", warehouses.map((w) => w.name)],
        ["actual_qty", "<", 0],
      ],
      ["item_code", "warehouse", "actual_qty"],
    );
    if (bins.length === 0) return [];

    const items = await this.list<{ name: string; item_name?: string }>(
      env,
      ctx,
      "Item",
      [["name", "in", [...new Set(bins.map((b) => b.item_code))]]],
      ["name", "item_name"],
    );
    const names = new Map(items.map((i) => [i.name, i.item_name || i.name]));

    return bins
      .map((b) => ({ itemCode: b.item_code, itemName: names.get(b.item_code) ?? b.item_code, warehouse: b.warehouse, qty: Number(b.actual_qty) }))
      .sort((a, b) => a.qty - b.qty);
  }

  private async list<T>(env: ErpEnvironment, ctx: ErpCallContext, doctype: string, filters: unknown[], fields: string[]): Promise<T[]> {
    const path =
      `/api/resource/${encodeURIComponent(doctype)}?filters=${encodeURIComponent(JSON.stringify(filters))}` +
      `&fields=${encodeURIComponent(JSON.stringify(fields))}&limit_page_length=0`;
    const res = await this.client.call(env, ctx, { method: "GET", path });
    const data = (res.body as { data?: T[] })?.data;
    return Array.isArray(data) ? data : [];
  }
}
