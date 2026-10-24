import { describe, expect, it, vi, beforeEach } from "vitest";

const mockDb = {
  tenant: { findUnique: vi.fn() },
  khataPayment: { findUnique: vi.fn(), update: vi.fn() },
};
vi.mock("@/server/db", () => ({ db: mockDb }));

const { ErpPaymentAdapter } = await import("@/server/erp/paymentAdapter");
const { FakeErpTransport } = await import("@/server/erp/fakeTransport");

const COMPANY = "Acme Fashion";

/** ERPNext where each Mode of Payment links `accounts` for this company, and one open invoice. */
function erp(modeAccounts: Record<string, string | undefined>) {
  const t = new FakeErpTransport();
  const posted: Array<Record<string, unknown>> = [];
  t.send = async (req) => {
    const path = decodeURIComponent(req.path);
    if (req.method === "POST" && path === "/api/resource/Payment Entry") {
      posted.push(req.body as Record<string, unknown>);
      return { status: 200, body: { data: { name: "ACC-PAY-1" } } };
    }
    if (path.startsWith("/api/resource/Payment Entry?")) return { status: 200, body: { data: [] } };
    if (path.startsWith("/api/resource/Customer?")) return { status: 200, body: { data: [{ name: "Asha" }] } };
    if (path.startsWith("/api/resource/Sales Invoice?")) {
      return { status: 200, body: { data: [{ name: "SINV-1", outstanding_amount: 5000, grand_total: 5000, posting_date: "2026-10-01" }] } };
    }
    if (path === `/api/resource/Company/${COMPANY}`) return { status: 200, body: { data: { name: COMPANY, abbr: "AF" } } };
    const mode = path.match(/\/Mode of Payment\/(.+)$/)?.[1];
    if (mode) {
      const account = modeAccounts[mode];
      return { status: 200, body: { data: { name: mode, accounts: account ? [{ company: COMPANY, default_account: account }] : [] } } };
    }
    return { status: 404, body: {} };
  };
  return { adapter: new ErpPaymentAdapter(t), posted };
}

function payment(paymentMethod: "CASH" | "UPI" | "CARD") {
  mockDb.khataPayment.findUnique.mockResolvedValue({
    id: "pay-1",
    customerId: "cust-1",
    amountMinor: 120_000,
    paymentMethod,
    notes: null,
    createdAt: new Date("2026-10-20T04:00:00Z"),
    customer: { name: "Asha" },
  });
}

describe("ErpPaymentAdapter — Mode of Payment and paid-to account", () => {
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
    mockDb.khataPayment.update.mockResolvedValue({});
  });

  it.each([
    ["CASH", "Cash", "Cash - AF"],
    ["UPI", "UPI", "HDFC Current - AF"],
    ["CARD", "Credit Card", "HDFC Current - AF"],
  ] as const)("%s posts as Mode of Payment %s into the account linked for the company", async (method, mode, account) => {
    payment(method);
    const { adapter, posted } = erp({ Cash: "Cash - AF", UPI: "HDFC Current - AF", "Credit Card": "HDFC Current - AF" });
    await adapter.syncPayment("tenant-1", "pay-1", "c1");
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ mode_of_payment: mode, paid_to: account, paid_from: "Debtors - AF" });
  });

  it("never posts to a Mode of Payment named Bank or a guessed Bank account", async () => {
    payment("UPI");
    const { adapter, posted } = erp({ UPI: "HDFC Current - AF" });
    await adapter.syncPayment("tenant-1", "pay-1", "c1");
    expect(posted[0]!.mode_of_payment).not.toBe("Bank");
    expect(posted[0]!.paid_to).not.toBe("Bank - AF");
  });

  it("refuses rather than guessing when the mode has no account for this company", async () => {
    payment("UPI");
    const { adapter, posted } = erp({});
    await expect(adapter.syncPayment("tenant-1", "pay-1", "c1")).rejects.toThrow(/no account for Acme Fashion/);
    expect(posted).toHaveLength(0);
  });
});
