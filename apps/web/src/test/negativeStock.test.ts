import { describe, expect, it, vi, beforeEach } from "vitest";

const mockDb = { tenant: { findUnique: vi.fn() } };
vi.mock("@/server/db", () => ({ db: mockDb }));

const { ErpNegativeStockReader } = await import("@/server/erp/negativeStock");
const { FakeErpTransport } = await import("@/server/erp/fakeTransport");

const COMPANY = "Acme Fashion";

function reader() {
  const t = new FakeErpTransport();
  const writes: string[] = [];
  const binFilters: unknown[] = [];
  t.send = async (req) => {
    if (req.method !== "GET") writes.push(req.method);
    const url = new URL(`http://x${req.path}`);
    const doctype = decodeURIComponent(url.pathname.replace("/api/resource/", ""));
    const filters = JSON.parse(url.searchParams.get("filters") ?? "[]");
    if (doctype === "Warehouse") return { status: 200, body: { data: [{ name: "Ring Road - AF" }] } };
    if (doctype === "Bin") {
      binFilters.push(filters);
      return {
        status: 200,
        body: {
          data: [
            { item_code: "i-2", warehouse: "Ring Road - AF", actual_qty: -3 },
            { item_code: "i-1", warehouse: "Ring Road - AF", actual_qty: -95 },
          ],
        },
      };
    }
    if (doctype === "Item") return { status: 200, body: { data: [{ name: "i-1", item_name: "Red Tee XL" }, { name: "i-2", item_name: "Navy Leggings M" }] } };
    return { status: 404, body: {} };
  };
  return { reader: new ErpNegativeStockReader(t), writes, binFilters };
}

describe("ErpNegativeStockReader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["ERP_SITE_TEST_SITE_LOCAL_URL"] = "http://test-site.local";
    process.env["ERP_SITE_TEST_SITE_LOCAL_KEY"] = "test-key";
    process.env["ERP_SITE_TEST_SITE_LOCAL_SECRET"] = "test-secret";
    mockDb.tenant.findUnique.mockResolvedValue({
      id: "tenant-1",
      erpnextSiteId: "test-site.local",
      erpnextProvisionStatus: "PROVISIONED",
      erpnextCompanyId: COMPANY,
    });
  });

  it("lists this company's below-zero items with names, most negative first, using reads only", async () => {
    const { reader: r, writes, binFilters } = reader();
    const lines = await r.listNegativeStock("tenant-1", "c1");
    expect(lines).toEqual([
      { itemCode: "i-1", itemName: "Red Tee XL", warehouse: "Ring Road - AF", qty: -95 },
      { itemCode: "i-2", itemName: "Navy Leggings M", warehouse: "Ring Road - AF", qty: -3 },
    ]);
    expect(binFilters[0]).toEqual([
      ["warehouse", "in", ["Ring Road - AF"]],
      ["actual_qty", "<", 0],
    ]);
    expect(writes).toEqual([]);
  });

  it("makes no claim for a business that isn't connected", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({ id: "tenant-1", erpnextSiteId: null, erpnextProvisionStatus: "NOT_PROVISIONED", erpnextCompanyId: null });
    await expect(reader().reader.listNegativeStock("tenant-1", "c1")).resolves.toBeNull();
  });
});
