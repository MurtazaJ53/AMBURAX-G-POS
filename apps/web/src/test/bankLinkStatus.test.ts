import { describe, expect, it, vi, beforeEach } from "vitest";

const mockDb = { tenant: { findUnique: vi.fn() } };
vi.mock("@/server/db", () => ({ db: mockDb }));

const { ErpBankLinkReader } = await import("@/server/erp/bankLinkStatus");
const { FakeErpTransport } = await import("@/server/erp/fakeTransport");

type Row = { company: string; default_account: string };
const COMPANY = "Acme Fashion";
const HDFC = { company: COMPANY, is_group: 0, account_type: "Bank" };

function reader(modes: Record<string, Row[]>, accounts: Record<string, object>) {
  const t = new FakeErpTransport();
  t.send = async (req) => {
    const path = decodeURIComponent(req.path);
    if (path.endsWith(`/Company/${COMPANY}`)) return { status: 200, body: { data: { name: COMPANY, abbr: "AF" } } };
    const mode = path.match(/\/Mode of Payment\/(.+)$/)?.[1];
    if (mode) return modes[mode] ? { status: 200, body: { data: { accounts: modes[mode] } } } : { status: 404, body: {} };
    const account = path.match(/\/Account\/(.+)$/)?.[1];
    if (account && accounts[account]) return { status: 200, body: { data: accounts[account] } };
    return { status: 404, body: {} };
  };
  return new ErpBankLinkReader(t);
}

const row = (default_account: string): Row[] => [{ company: COMPANY, default_account }];

describe("ErpBankLinkReader", () => {
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

  it("reports the placeholder while either bank mode still uses Bank - {abbr}", async () => {
    const r = reader({ UPI: row("HDFC - AF"), "Credit Card": row("Bank - AF") }, { "HDFC - AF": HDFC });
    await expect(r.getBankLinkStatus("tenant-1", "c1")).resolves.toBe("placeholder");
  });

  it("reports linked once both point at a real leaf bank account of this company", async () => {
    const r = reader({ UPI: row("HDFC - AF"), "Credit Card": row("HDFC - AF") }, { "HDFC - AF": HDFC });
    await expect(r.getBankLinkStatus("tenant-1", "c1")).resolves.toBe("linked");
  });

  it("does not count a group or another company's account as linked", async () => {
    const group = reader({ UPI: row("Bank Accounts - AF"), "Credit Card": row("HDFC - AF") }, {
      "Bank Accounts - AF": { ...HDFC, is_group: 1 },
      "HDFC - AF": HDFC,
    });
    await expect(group.getBankLinkStatus("tenant-1", "c1")).resolves.toBe("placeholder");
    const other = reader({ UPI: row("HDFC - AF"), "Credit Card": row("HDFC - AF") }, { "HDFC - AF": { ...HDFC, company: "Other" } });
    await expect(other.getBankLinkStatus("tenant-1", "c1")).resolves.toBe("placeholder");
  });

  it("makes no claim for a business that isn't connected", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({ id: "tenant-1", erpnextSiteId: null, erpnextProvisionStatus: "NOT_PROVISIONED", erpnextCompanyId: null });
    await expect(reader({}, {}).getBankLinkStatus("tenant-1", "c1")).resolves.toBe("unknown");
  });
});
