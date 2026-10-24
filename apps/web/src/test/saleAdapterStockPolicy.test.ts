import { describe, it, expect, vi } from "vitest";

const { mockSaleDb } = vi.hoisted(() => ({
  mockSaleDb: { sale: { findUnique: vi.fn(), update: vi.fn() } },
}));

vi.mock("@/server/db", () => ({ db: mockSaleDb }));
vi.mock("@/server/erp/config", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    resolveErpEnvironment: vi.fn().mockResolvedValue({
      status: "ok",
      environment: { siteId: "test", tenantId: "t1", companyId: "Shree Krishna Fashion" },
    }),
  };
});

const { ErpSaleAdapter } = await import("@/server/erp/saleAdapter");

/** An adapter whose submit (PUT docstatus 1) fails with `submitError`. */
function adapterWithSubmitError(submitError: Error) {
  const sent: Array<{ method: string; path: string; body?: any }> = [];
  const adapter = new ErpSaleAdapter({} as any);
  (adapter as any).client = {
    call: async (_env: any, _ctx: any, req: any) => {
      sent.push({ method: req.method, path: req.path, body: req.body });
      if (req.method === "GET" && req.path.includes("Warehouse")) {
        return { status: 200, body: { data: { company: "Shree Krishna Fashion" } } };
      }
      if (req.method === "GET") return { status: 200, body: { data: [] } };
      if (req.method === "POST" && req.path === "/api/resource/Sales Invoice") {
        return {
          status: 200,
          body: { data: { name: "ACC-SINV-T", docstatus: 0, currency: "INR", conversion_rate: 1, price_list_currency: "INR", plc_conversion_rate: 1 } },
        };
      }
      if (req.method === "PUT") throw submitError;
      return { status: 200, body: {} };
    },
  };
  return { adapter, sent };
}

function sale() {
  const at = new Date("2025-05-18T13:42:00.000Z");
  mockSaleDb.sale.findUnique.mockResolvedValue({
    id: "sale-1",
    completedAt: at,
    createdAt: at,
    erpSyncStatus: "PENDING",
    storeId: "store-1",
    store: { erpnextWarehouseId: "Ring Road (RINGRD) - SKF", company: { code: "SKF" } },
    items: [{ variantId: "var-1", quantity: 1, unitPriceMinor: 50000, discountMinor: 0, taxAmountMinor: 0 }],
    payments: [{ method: "CASH", amountMinor: 50000 }],
    tenant: { taxId: null },
    discountMinor: 0,
  });
  mockSaleDb.sale.update.mockResolvedValue({});
}

describe("sale sync stock policy: every sale moves stock", () => {
  it.each([
    "NegativeStockError: 1.0 units of Item X needed in Warehouse Ring Road (RINGRD) - SKF",
    "Insufficient Stock for Item X",
  ])("a stock refusal (%s) is raised, never re-posted without update_stock", async (message) => {
    sale();
    const { adapter, sent } = adapterWithSubmitError(new Error(message));

    await expect(adapter.syncSale("t1", "sale-1", "corr")).rejects.toThrow(message);

    const posts = sent.filter((r) => r.method === "POST" && r.path === "/api/resource/Sales Invoice");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body.update_stock).toBe(1);
    expect(sent.some((r) => r.body?.update_stock === 0)).toBe(false);
  });
});
