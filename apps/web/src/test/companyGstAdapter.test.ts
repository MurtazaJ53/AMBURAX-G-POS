import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  tenant: { findUnique: vi.fn() },
  store: { findFirst: vi.fn() },
};
vi.mock("@/server/db", () => ({ db }));

const resolveErpEnvironment = vi.fn();
vi.mock("@/server/erp/config", () => ({
  resolveErpEnvironment,
  EnvErpCredentialProvider: class {
    async credentialsFor() {
      return { baseUrl: "http://erp.test", apiKey: "k", apiSecret: "s" };
    }
  },
}));

const { ErpCompanyGstAdapter } = await import("@/server/erp/companyGstAdapter");
const { FakeErpTransport } = await import("@/server/erp/fakeTransport");

const env = { tenantId: "t1", siteId: "site", clusterId: null, companyId: "Acme Pvt Ltd", version: null };

beforeEach(() => {
  vi.clearAllMocks();
  resolveErpEnvironment.mockResolvedValue({ status: "ok", environment: env });
});

describe("ErpCompanyGstAdapter.syncCompanyGstin", () => {
  it("does nothing for a business without a GSTIN", async () => {
    db.tenant.findUnique.mockResolvedValue({ taxId: "  " });
    const t = new FakeErpTransport();
    await new ErpCompanyGstAdapter(t).syncCompanyGstin("t1", "c1");
    expect(t.sent).toHaveLength(0);
    expect(resolveErpEnvironment).not.toHaveBeenCalled();
  });

  it("refuses when the business is not connected to ERPNext", async () => {
    db.tenant.findUnique.mockResolvedValue({ taxId: "24aaaaa0000a1z5" });
    resolveErpEnvironment.mockResolvedValue({ status: "not_configured" });
    await expect(new ErpCompanyGstAdapter(new FakeErpTransport()).syncCompanyGstin("t1", "c1")).rejects.toMatchObject({
      kind: "configuration_error",
    });
  });

  it("sets the upper-cased GSTIN on the company and updates its existing address", async () => {
    db.tenant.findUnique.mockResolvedValue({ taxId: " 24aaaaa0000a1z5 " });
    const t = new FakeErpTransport().script(
      { kind: "respond", status: 200, body: { data: {} } },
      { kind: "respond", status: 200, body: { data: [{ name: "Acme-Billing" }] } },
      { kind: "respond", status: 200, body: { data: {} } },
    );
    await new ErpCompanyGstAdapter(t).syncCompanyGstin("t1", "c1");
    expect(t.sent.map((r) => r.method)).toEqual(["PUT", "GET", "PUT"]);
    expect(t.sent[0]!.path).toBe("/api/resource/Company/Acme%20Pvt%20Ltd");
    expect(t.sent[0]!.body).toEqual({ tax_id: "24AAAAA0000A1Z5", gstin: "24AAAAA0000A1Z5", gst_category: "Registered Regular" });
    expect(t.sent[2]!.path).toBe("/api/resource/Address/Acme-Billing");
    expect(t.sent[2]!.body).toEqual({ gstin: "24AAAAA0000A1Z5", gst_category: "Registered Regular" });
    expect(db.store.findFirst).not.toHaveBeenCalled();
  });

  it("creates the company address from the main store when none exists", async () => {
    db.tenant.findUnique.mockResolvedValue({ taxId: "24AAAAA0000A1Z5" });
    db.store.findFirst.mockResolvedValue({ addressLine: "1 MG Road", city: "Surat", state: "Gujarat", postalCode: null, phone: "9800000000" });
    const t = new FakeErpTransport().script(
      { kind: "respond", status: 200, body: { data: {} } },
      { kind: "respond", status: 200, body: { data: [] } },
      { kind: "respond", status: 200, body: { data: {} } },
    );
    await new ErpCompanyGstAdapter(t).syncCompanyGstin("t1", "c1");
    expect(t.sent.map((r) => r.method)).toEqual(["PUT", "GET", "POST"]);
    const body = t.sent[2]!.body as Record<string, unknown>;
    expect(body).toMatchObject({
      address_title: "Acme Pvt Ltd",
      address_line1: "1 MG Road",
      city: "Surat",
      state: "Gujarat",
      gstin: "24AAAAA0000A1Z5",
      is_your_company_address: 1,
      links: [{ link_doctype: "Company", link_name: "Acme Pvt Ltd" }],
    });
    expect(body.pincode).toBeUndefined();
  });

  it("stops after the company update when there is no address and no store", async () => {
    db.tenant.findUnique.mockResolvedValue({ taxId: "24AAAAA0000A1Z5" });
    db.store.findFirst.mockResolvedValue(null);
    const t = new FakeErpTransport().script(
      { kind: "respond", status: 200, body: { data: {} } },
      { kind: "respond", status: 200, body: { data: [] } },
    );
    await new ErpCompanyGstAdapter(t).syncCompanyGstin("t1", "c1");
    expect(t.sent.map((r) => r.method)).toEqual(["PUT", "GET"]);
  });
});
