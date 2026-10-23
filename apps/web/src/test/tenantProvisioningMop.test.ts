import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDb = {
  tenant: {
    findUniqueOrThrow: vi.fn(),
    update: vi.fn(),
  },
  company: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
  },
  store: {
    updateMany: vi.fn(),
    findMany: vi.fn(),
  },
  outboxEvent: {
    create: vi.fn(),
  },
  auditLog: {
    create: vi.fn(),
  },
  $transaction: vi.fn(async (cb) => cb({})),
};

vi.mock("@/server/db", () => ({ db: mockDb }));
vi.mock("@/server/audit/auditLog", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/server/events/outboxQueue", () => ({ enqueueOutboxEvent: vi.fn(async () => {}) }));

const { TenantProvisioner } = await import("@/server/erp/tenantProvisioning");
const { FakeErpTransport } = await import("@/server/erp/fakeTransport");

describe("TenantProvisioner - Mode of Payment Setup (Fix 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["ERP_SITE_TEST_SITE_LOCAL_URL"] = "http://test-site.local";
    process.env["ERP_SITE_TEST_SITE_LOCAL_KEY"] = "test-key";
    process.env["ERP_SITE_TEST_SITE_LOCAL_SECRET"] = "test-secret";
  });

  it("provisions a leaf Bank account and configures Cash, UPI, and Credit Card for THIS company only", async () => {
    mockDb.tenant.findUniqueOrThrow.mockResolvedValue({
      id: "tenant-1",
      name: "Acme Fashion",
      slug: "acme-fashion",
      taxId: "24AAAAA0000A1Z5",
      erpnextSiteId: "test-site.local",
      erpnextCompanyId: null,
    });
    mockDb.company.upsert.mockResolvedValue({ id: "comp-1" });
    mockDb.store.updateMany.mockResolvedValue({ count: 1 });
    mockDb.store.findMany.mockResolvedValue([]);

    const t = new FakeErpTransport();
    // 1. Check company name -> 404 (not found)
    // 2. freeAbbreviation -> 200 [] (free)
    // 3. POST Company -> 200
    t.script(
      { kind: "respond", status: 404, body: {} },
      { kind: "respond", status: 200, body: { data: [] } },
      { kind: "respond", status: 200, body: { data: { name: "Acme Fashion", abbr: "AF" } } },
    );

    // Dynamic responses:
    // When GET Mode of Payment/Cash, return existing with another company's account
    // When GET Mode of Payment/UPI, return existing with another company's account
    // When GET Mode of Payment/Credit Card, return 404
    t.always({
      kind: "respond",
      status: 200,
      body: { data: {} },
    });

    const calls: Array<{ method: string; path: string; body?: any }> = [];
    const origSend = t.send.bind(t);
    t.send = async (req, creds) => {
      calls.push({ method: req.method, path: req.path, body: req.body });
      if (t.sent.length < 3) return origSend(req, creds);
      if (req.method === "GET") {
        if (req.path.startsWith("/api/resource/Mode%20of%20Payment/Cash") || req.path.startsWith("/api/resource/Mode of Payment/Cash")) {
          return {
            status: 200,
            body: {
              data: {
                name: "Cash",
                accounts: [{ company: "Other Company", default_account: "Cash - OC" }],
              },
            },
          };
        }
        if (req.path.startsWith("/api/resource/Mode%20of%20Payment/UPI") || req.path.startsWith("/api/resource/Mode of Payment/UPI")) {
          return {
            status: 200,
            body: {
              data: {
                name: "UPI",
                accounts: [{ company: "Other Company", default_account: "Bank - OC" }],
              },
            },
          };
        }
        if (req.path.includes("Credit%20Card") || req.path.includes("Credit Card")) {
          return { status: 404, body: {} };
        }
        if (req.path.includes("/Account/Bank%20-%20AF")) {
          return { status: 404, body: {} }; // does not exist yet
        }
        return { status: 404, body: {} };
      }
      return { status: 200, body: { data: {} } };
    };

    const provisioner = new TenantProvisioner(t, {
      kind: "existing",
      ensureSite: async () => ({ status: "ready", siteId: "test-site.local" }),
    });

    await provisioner.provision("tenant-1", "corr-test-1");

    // Check leaf bank account was created
    const postAccount = calls.find(
      (c) => c.method === "POST" && c.path === "/api/resource/Account" && c.body?.account_name === "Bank",
    );
    expect(postAccount).toBeDefined();
    expect(postAccount?.body).toMatchObject({
      account_name: "Bank",
      parent_account: "Bank Accounts - AF",
      company: "Acme Fashion",
      account_type: "Bank",
      is_group: 0,
    });

    // Check Mode of Payment Cash was updated (PUT) preserving Other Company
    const putCash = calls.find(
      (c) => c.method === "PUT" && c.path.includes("Mode") && c.path.includes("Cash"),
    );
    expect(putCash).toBeDefined();
    expect(putCash?.body.accounts).toEqual([
      { company: "Other Company", default_account: "Cash - OC" },
      { company: "Acme Fashion", default_account: "Cash - AF" },
    ]);

    // Check Mode of Payment UPI was updated (PUT) preserving Other Company
    const putUpi = calls.find(
      (c) => c.method === "PUT" && c.path.includes("Mode") && c.path.includes("UPI"),
    );
    expect(putUpi).toBeDefined();
    expect(putUpi?.body.accounts).toEqual([
      { company: "Other Company", default_account: "Bank - OC" },
      { company: "Acme Fashion", default_account: "Bank - AF" },
    ]);

    // Check Mode of Payment Credit Card was created (POST) since it returned 404
    const postCard = calls.find(
      (c) => c.method === "POST" && c.path.includes("Mode") && c.body?.mode_of_payment === "Credit Card",
    );
    expect(postCard).toBeDefined();
    expect(postCard?.body).toMatchObject({
      doctype: "Mode of Payment",
      mode_of_payment: "Credit Card",
      type: "Bank",
      accounts: [{ company: "Acme Fashion", default_account: "Bank - AF" }],
    });
  });

  it("is idempotent and updates account if mismatched, leaving other companies untouched", async () => {
    mockDb.tenant.findUniqueOrThrow.mockResolvedValue({
      id: "tenant-1",
      name: "Acme Fashion",
      slug: "acme-fashion",
      taxId: null,
      erpnextSiteId: "test-site.local",
      erpnextCompanyId: "Acme Fashion",
    });
    mockDb.company.upsert.mockResolvedValue({ id: "comp-1" });
    mockDb.store.updateMany.mockResolvedValue({ count: 0 });
    mockDb.store.findMany.mockResolvedValue([]);

    const t = new FakeErpTransport();
    const calls: Array<{ method: string; path: string; body?: any }> = [];

    t.send = async (req) => {
      calls.push({ method: req.method, path: req.path, body: req.body });
      if (req.method === "GET") {
        if (req.path.includes("Company/Acme")) {
          return { status: 200, body: { data: { name: "Acme Fashion", abbr: "AF" } } };
        }
        if (req.path.includes("Cash")) {
          // Already properly mapped -> no PUT needed
          return {
            status: 200,
            body: {
              data: {
                name: "Cash",
                accounts: [
                  { company: "Acme Fashion", default_account: "Cash - AF" },
                  { company: "Other", default_account: "Cash - OT" },
                ],
              },
            },
          };
        }
        if (req.path.includes("UPI")) {
          // Wrongly mapped to old account -> should update to Bank - AF
          return {
            status: 200,
            body: {
              data: {
                name: "UPI",
                accounts: [
                  { company: "Acme Fashion", default_account: "Wrong - AF" },
                  { company: "Other", default_account: "Bank - OT" },
                ],
              },
            },
          };
        }
        if (req.path.includes("Credit%20Card") || req.path.includes("Credit Card")) {
          // Correctly mapped
          return {
            status: 200,
            body: {
              data: {
                name: "Credit Card",
                accounts: [{ company: "Acme Fashion", default_account: "Bank - AF" }],
              },
            },
          };
        }
      }
      return { status: 200, body: { data: { name: "mock" } } };
    };

    const provisioner = new TenantProvisioner(t, {
      kind: "existing",
      ensureSite: async () => ({ status: "ready", siteId: "test-site.local" }),
    });

    await provisioner.provision("tenant-1", "corr-test-2");

    // Cash was already matching -> no PUT
    const putCash = calls.find(
      (c) => c.method === "PUT" && c.path.includes("Mode") && c.path.includes("Cash"),
    );
    expect(putCash).toBeUndefined();

    // Credit Card was already matching -> no PUT
    const putCard = calls.find(
      (c) => c.method === "PUT" && c.path.includes("Mode") && c.path.includes("Credit"),
    );
    expect(putCard).toBeUndefined();

    // UPI had wrong account -> PUT updating Acme Fashion and keeping Other untouched
    const putUpi = calls.find(
      (c) => c.method === "PUT" && c.path.includes("Mode") && c.path.includes("UPI"),
    );
    expect(putUpi).toBeDefined();
    expect(putUpi?.body.accounts).toEqual([
      { company: "Acme Fashion", default_account: "Bank - AF" },
      { company: "Other", default_account: "Bank - OT" },
    ]);
  });
});

describe("TenantProvisioner - Mode of Payment re-run keeps the owner's choice", () => {
  type Row = { company: string; default_account: string };
  type AccountDoc = { company: string; is_group: number; account_type?: string };

  /** Re-provision an already-linked company with the given UPI rows and Account docs. */
  async function reprovision(upiRows: Row[] | null, accounts: Record<string, AccountDoc>) {
    mockDb.tenant.findUniqueOrThrow.mockResolvedValue({
      id: "tenant-1",
      name: "Acme Fashion",
      slug: "acme-fashion",
      taxId: null,
      erpnextSiteId: "test-site.local",
      erpnextCompanyId: "Acme Fashion",
    });
    mockDb.company.upsert.mockResolvedValue({ id: "comp-1" });
    mockDb.store.updateMany.mockResolvedValue({ count: 0 });
    mockDb.store.findMany.mockResolvedValue([]);

    const t = new FakeErpTransport();
    const calls: Array<{ method: string; path: string; body?: any }> = [];
    t.send = async (req) => {
      calls.push({ method: req.method, path: req.path, body: req.body });
      const path = decodeURIComponent(req.path);
      if (req.method === "GET") {
        if (path.includes("/Company/Acme")) return { status: 200, body: { data: { name: "Acme Fashion", abbr: "AF" } } };
        if (path.endsWith("/Mode of Payment/UPI")) {
          return upiRows ? { status: 200, body: { data: { name: "UPI", accounts: upiRows } } } : { status: 404, body: {} };
        }
        if (path.includes("/Mode of Payment/")) return { status: 404, body: {} };
        const account = path.match(/\/Account\/(.+)$/)?.[1];
        if (account && accounts[account]) return { status: 200, body: { data: { name: account, ...accounts[account] } } };
        if (account) return { status: 404, body: {} };
      }
      return { status: 200, body: { data: { name: "mock" } } };
    };

    const provisioner = new TenantProvisioner(t, {
      kind: "existing",
      ensureSite: async () => ({ status: "ready", siteId: "test-site.local" }),
    });
    await provisioner.provision("tenant-1", "corr-rerun");
    const writes = calls.filter((c) => c.path.includes("UPI") && c.method !== "GET");
    return Object.assign(writes, { calls });
  }

  const OTHER: Row = { company: "Other", default_account: "Bank - OT" };

  it("(a) leaves a valid leaf account the owner linked untouched", async () => {
    const writes = await reprovision([{ company: "Acme Fashion", default_account: "HDFC Current - AF" }, OTHER], {
      "HDFC Current - AF": { company: "Acme Fashion", is_group: 0, account_type: "Bank" },
    });
    expect(writes).toHaveLength(0);
  });

  it.each([
    ["a group account", { "Bank Accounts - AF": { company: "Acme Fashion", is_group: 1 } }, "Bank Accounts - AF"],
    ["another company's account", { "HDFC - OT": { company: "Other", is_group: 0 } }, "HDFC - OT"],
    ["an account that no longer exists", {}, "Deleted - AF"],
  ])("(b) corrects %s back to the company's bank account", async (_label, accounts, current) => {
    const writes = await reprovision([{ company: "Acme Fashion", default_account: current }, OTHER], accounts);
    expect(writes).toHaveLength(1);
    expect(writes[0]!.method).toBe("PUT");
    expect(writes[0]!.body.accounts).toEqual([{ company: "Acme Fashion", default_account: "Bank - AF" }, OTHER]);
  });

  it("(c) adds a row for this company when it is missing, keeping other companies", async () => {
    const writes = await reprovision([OTHER], {});
    expect(writes).toHaveLength(1);
    expect(writes[0]!.body.accounts).toEqual([OTHER, { company: "Acme Fashion", default_account: "Bank - AF" }]);
  });

  it("(c) creates the Mode of Payment itself when it does not exist", async () => {
    const { calls } = await reprovision(null, {});
    const created = calls.find((c) => c.method === "POST" && c.body?.mode_of_payment === "UPI");
    expect(created?.path).toBe("/api/resource/Mode of Payment");
    expect(created?.body.accounts).toEqual([{ company: "Acme Fashion", default_account: "Bank - AF" }]);
  });
});
