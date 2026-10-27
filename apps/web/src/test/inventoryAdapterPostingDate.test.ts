import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ErpRequest, ErpResponse } from "@/server/erp/transport";

// The Stock Entry a stock movement becomes must be dated by when the movement happened, in India
// time: a receipt at 01:30 IST belongs to that day, not to the previous UTC day.

const movementFindUnique = vi.fn();
vi.mock("@/server/db", () => ({ db: { stockMovement: { findUnique: movementFindUnique } } }));
vi.mock("@/server/erp/config", () => ({
  resolveErpEnvironment: vi.fn(async () => ({
    status: "ok",
    environment: { tenantId: "t-1", siteId: "frontend", clusterId: null, companyId: "Test Co", version: null },
  })),
  EnvErpCredentialProvider: class {
    async credentialsFor() {
      return { baseUrl: "http://erp.test.invalid", apiKey: "k", apiSecret: "s" };
    }
  },
}));
vi.mock("@/server/erp/documentSync", async (orig) => ({
  ...(await orig()),
  requireCompany: () => "Test Co",
  assertWarehouseCompanyMatch: vi.fn(async () => {}),
}));

const { ErpInventoryAdapter } = await import("@/server/erp/inventoryAdapter");

const posted: Record<string, unknown>[] = [];
const transport = {
  async send(request: ErpRequest): Promise<ErpResponse> {
    if (request.method === "GET") return { status: 200, body: { data: [] } };
    posted.push(request.body as Record<string, unknown>);
    return { status: 200, body: { data: { name: "MAT-STE-0001" } } };
  },
};

beforeEach(() => {
  posted.length = 0;
  movementFindUnique.mockResolvedValue({
    id: "mv-1",
    tenantId: "t-1",
    storeId: "s-1",
    variantId: "v-1",
    quantityDelta: 5,
    unitCostMinor: 40_000,
    isFreeSample: false,
    // 2026-10-26 20:00 UTC = 2026-10-27 01:30 IST
    occurredAt: new Date("2026-10-26T20:00:00.000Z"),
    store: { erpnextWarehouseId: "Main - TC" },
    variant: { product: {} },
  });
});

describe("stock entry posting date", () => {
  it("dates the entry by the movement's time in India, not the UTC day", async () => {
    await new ErpInventoryAdapter(transport).syncMovement("t-1", "mv-1", "corr-1");
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ posting_date: "2026-10-27", posting_time: "01:30:00", set_posting_time: 1 });
  });
});
