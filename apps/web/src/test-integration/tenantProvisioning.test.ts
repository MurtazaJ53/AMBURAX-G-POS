import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, IDS, resetDatabase, seedTwoTenants } from "./db";
import { FakeErpTransport } from "@/server/erp/fakeTransport";
import { ErpStoreAdapter } from "@/server/erp/storeAdapter";
import { requireCompany } from "@/server/erp/documentSync";
import {
  DevSharedSiteProvisioner,
  FrappeCloudSiteProvisioner,
  TenantProvisioner,
  abbreviationFor,
  companyMarker,
  requestErpConnection,
} from "@/server/erp/tenantProvisioning";

/** ADR-077/078: connecting a business to ERPNext — site, Company, AMBURAX company, warehouses. */

const owner = { tenantId: IDS.tenantA, userId: IDS.ownerA, tenantRole: "OWNER" as const };
const staff = { tenantId: IDS.tenantA, userId: IDS.staffA, tenantRole: "STAFF" as const };
const site = new DevSharedSiteProvisioner("test-site.local");

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
  process.env["ERP_SITE_TEST_SITE_LOCAL_URL"] = "http://test-site.local";
  process.env["ERP_SITE_TEST_SITE_LOCAL_KEY"] = "test-key";
  process.env["ERP_SITE_TEST_SITE_LOCAL_SECRET"] = "test-secret";
});

afterAll(async () => {
  await resetDatabase();
});

const tenantA = () => db.tenant.findUniqueOrThrow({ where: { id: IDS.tenantA } });

describe("connecting a business", () => {
  it("creates an INR / India company with this business's marker, links stores and queues their warehouses", async () => {
    const t = new FakeErpTransport();
    t.script(
      { kind: "respond", status: 404, body: { message: "not found" } }, // Company by name
      { kind: "respond", status: 200, body: { data: [] } }, // abbreviation free
      { kind: "respond", status: 200, body: { data: { name: "Tenant A Retail" } } }, // POST Company
    );
    await new TenantProvisioner(t, site).provision(IDS.tenantA, "c-1");

    const post = t.sent[2]!;
    expect(post.method).toBe("POST");
    expect(post.path).toBe("/api/resource/Company");
    expect(post.body).toMatchObject({ company_name: "Tenant A Retail", abbr: "TAR", default_currency: "INR", country: "India" });
    expect((post.body as { company_description: string }).company_description).toContain(companyMarker(IDS.tenantA));

    const tenant = await tenantA();
    expect(tenant).toMatchObject({ erpnextProvisionStatus: "PROVISIONED", erpnextSiteId: "test-site.local", erpnextCompanyId: "Tenant A Retail" });
    const company = await db.company.findFirstOrThrow({ where: { tenantId: IDS.tenantA } });
    expect(company).toMatchObject({ name: "Tenant A Retail", code: "TAR", currency: "INR" });
    expect(await db.store.count({ where: { tenantId: IDS.tenantA, companyId: company.id } })).toBe(
      await db.store.count({ where: { tenantId: IDS.tenantA } }),
    );
    const queued = await db.outboxEvent.findMany({ where: { tenantId: IDS.tenantA, eventType: "StoreCreated" } });
    expect(queued.length).toBeGreaterThan(0);
    // Tenant B is untouched.
    expect((await db.tenant.findUniqueOrThrow({ where: { id: IDS.tenantB } })).erpnextCompanyId).toBeNull();
  });

  it("sets up GST accounts, purchase GST templates and the Indian financial year, so bills can post", async () => {
    const t = new FakeErpTransport();
    t.script(
      { kind: "respond", status: 404, body: {} },
      { kind: "respond", status: 200, body: { data: [] } },
      { kind: "respond", status: 200, body: { data: { name: "Tenant A Retail" } } },
    );
    // After the company: nothing exists yet (GET 404) and every create succeeds (POST 200).
    const send = t.send.bind(t);
    t.send = async (request, credentials) => {
      if (t.sent.length < 3) return send(request, credentials);
      t.sent.push(request);
      return request.method === "GET" ? { status: 404, body: {} } : { status: 200, body: { data: {} } };
    };
    const posts = () => t.sent.filter((r) => r.method === "POST");
    await new TenantProvisioner(t, site).provision(IDS.tenantA, "c-tax");
    const created = posts().map((r) => ({ path: r.path, body: r.body as Record<string, unknown> }));
    const of = (path: string) => created.filter((c) => c.path === path).map((c) => c.body);

    expect(of("/api/resource/Account").map((b) => b["account_name"])).toEqual([
      "Output Tax CGST", "Output Tax SGST", "Output Tax IGST", "Input Tax CGST", "Input Tax SGST", "Input Tax IGST",
    ]);
    expect(of("/api/resource/Account")[0]).toMatchObject({ parent_account: "Duties and Taxes - TAR", company: "Tenant A Retail", account_type: "Tax" });
    expect(of("/api/resource/Tax%20Category").map((b) => b["title"])).toEqual(["In-State", "Out-State"]);
    const templates = of("/api/resource/Purchase%20Taxes%20and%20Charges%20Template");
    expect(templates.map((b) => [b["tax_category"], (b["taxes"] as Array<{ account_head: string }>).map((x) => x.account_head)])).toEqual([
      ["In-State", ["Input Tax CGST - TAR", "Input Tax SGST - TAR"]],
      ["Out-State", ["Input Tax IGST - TAR"]],
    ]);
    const years = of("/api/resource/Fiscal%20Year");
    expect(years).toHaveLength(2);
    for (const y of years) {
      expect(y["year_start_date"]).toMatch(/^\d{4}-04-01$/);
      expect(y["year_end_date"]).toMatch(/^\d{4}-03-31$/);
      expect(y["companies"]).toEqual([{ company: "Tenant A Retail" }]);
    }
    expect((await tenantA()).erpnextProvisionStatus).toBe("PROVISIONED");
  });

  it("still connects when the backend refuses the tax setup (missing permission)", async () => {
    const t = new FakeErpTransport();
    t.script(
      { kind: "respond", status: 404, body: {} },
      { kind: "respond", status: 200, body: { data: [] } },
      { kind: "respond", status: 200, body: { data: { name: "Tenant A Retail" } } },
    );
    t.always({ kind: "respond", status: 403, body: { message: "Not permitted" } });
    await new TenantProvisioner(t, site).provision(IDS.tenantA, "c-tax-403");
    expect((await tenantA()).erpnextProvisionStatus).toBe("PROVISIONED");
  });

  it("renews every connected business's financial year ahead of 1 April, and leaves existing years alone", async () => {
    await db.tenant.update({
      where: { id: IDS.tenantA },
      data: { erpnextProvisionStatus: "PROVISIONED", erpnextSiteId: "test-site.local", erpnextCompanyId: "Tenant A Retail" },
    });
    await db.company.create({ data: { tenantId: IDS.tenantA, name: "Tenant A Retail", code: "TAR", currency: "INR" } });
    const t = new FakeErpTransport();
    t.script(
      { kind: "respond", status: 200, body: { data: { name: "TAR FY 2028-29" } } }, // this year exists
      { kind: "respond", status: 404, body: {} }, // next year doesn't
      { kind: "respond", status: 200, body: { data: {} } }, // created
    );
    const result = await new TenantProvisioner(t, site).renewFiscalYears(new Date("2029-03-15T00:00:00Z"));
    expect(result.checked).toBe(1);
    const posts = t.sent.filter((r) => r.method === "POST");
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toMatchObject({
      year: "TAR FY 2029-30",
      year_start_date: "2029-04-01",
      year_end_date: "2030-03-31",
      companies: [{ company: "Tenant A Retail" }],
    });
  });

  it("sends a GSTIN only when the business has one", async () => {
    await db.tenant.update({ where: { id: IDS.tenantA }, data: { taxId: "24abcde1234f1z5" } });
    const t = new FakeErpTransport();
    t.script(
      { kind: "respond", status: 404, body: {} },
      { kind: "respond", status: 200, body: { data: [] } },
      { kind: "respond", status: 200, body: { data: { name: "Tenant A Retail" } } },
    );
    await new TenantProvisioner(t, site).provision(IDS.tenantA, "c-2");
    expect(t.sent[2]!.body).toMatchObject({ tax_id: "24ABCDE1234F1Z5" });

    await db.tenant.update({ where: { id: IDS.tenantB }, data: { taxId: null } });
    const b = new FakeErpTransport();
    b.script(
      { kind: "respond", status: 404, body: {} },
      { kind: "respond", status: 200, body: { data: [] } },
      { kind: "respond", status: 200, body: { data: { name: "Tenant B Retail" } } },
    );
    await new TenantProvisioner(b, site).provision(IDS.tenantB, "c-2b");
    expect(b.sent[2]!.body).not.toHaveProperty("tax_id");
  });

  it("is safe to run again: the existing company is reused, nothing is created twice", async () => {
    const first = new FakeErpTransport();
    first.script(
      { kind: "respond", status: 404, body: {} },
      { kind: "respond", status: 200, body: { data: [] } },
      { kind: "respond", status: 200, body: { data: { name: "Tenant A Retail" } } },
    );
    await new TenantProvisioner(first, site).provision(IDS.tenantA, "c-3");
    const again = new FakeErpTransport();
    again.script({ kind: "respond", status: 200, body: { data: { name: "Tenant A Retail", abbr: "TAR" } } });
    again.always({ kind: "respond", status: 200, body: { data: { name: "already there" } } }); // tax setup exists
    await new TenantProvisioner(again, site).provision(IDS.tenantA, "c-4");
    expect(again.sent.filter((r) => r.method === "POST")).toHaveLength(0);
    expect(await db.company.count({ where: { tenantId: IDS.tenantA } })).toBe(1);
  });

  it("never takes over a same-named company it didn't create, and asks a person instead", async () => {
    const t = new FakeErpTransport();
    t.script({ kind: "respond", status: 200, body: { data: { name: "Tenant A Retail", abbr: "TA", default_currency: "INR", company_description: "" } } });
    await new TenantProvisioner(t, site).provision(IDS.tenantA, "c-5");
    expect(t.sent.filter((r) => r.method === "POST")).toHaveLength(0);
    const tenant = await tenantA();
    expect(tenant.erpnextProvisionStatus).toBe("FAILED");
    expect(tenant.erpnextCompanyId).toBeNull();
    expect(tenant.erpnextProvisionError).toContain("An administrator must confirm");
  });

  it("stops with a clear reason when no site can be created, without calling ERPNext", async () => {
    const t = new FakeErpTransport();
    await new TenantProvisioner(t, new FrappeCloudSiteProvisioner()).provision(IDS.tenantA, "c-6");
    expect(t.sent).toHaveLength(0);
    const tenant = await tenantA();
    expect(tenant.erpnextProvisionStatus).toBe("FAILED");
    expect(tenant.erpnextProvisionError).toContain("Frappe Cloud");
  });
});

describe("asking to connect", () => {
  it("is owner-only and queues one request", async () => {
    expect((await requestErpConnection({ actor: staff })).status).toBe("forbidden");
    expect((await requestErpConnection({ actor: owner })).status).toBe("queued");
    expect((await requestErpConnection({ actor: owner })).status).toBe("queued");
    expect(await db.outboxEvent.count({ where: { tenantId: IDS.tenantA, eventType: "TenantProvisionRequested" } })).toBe(1);
    expect((await tenantA()).erpnextProvisionStatus).toBe("PROVISIONING");
  });

  it("says so when already connected", async () => {
    await db.tenant.update({
      where: { id: IDS.tenantA },
      data: { erpnextProvisionStatus: "PROVISIONED", erpnextSiteId: "test-site.local", erpnextCompanyId: "X" },
    });
    expect((await requestErpConnection({ actor: owner })).status).toBe("already_connected");
  });
});

describe("before a business is connected", () => {
  it("a store waits instead of failing, and documents refuse to post without a company", async () => {
    const store = await db.store.findFirstOrThrow({ where: { tenantId: IDS.tenantA } });
    const t = new FakeErpTransport();
    await new ErpStoreAdapter(t).syncStore(IDS.tenantA, store.id, "c-7");
    expect(t.sent).toHaveLength(0);
    expect((await db.store.findUniqueOrThrow({ where: { id: store.id } })).erpnextProvisionStatus).toBe("NOT_PROVISIONED");

    expect(() => requireCompany({ tenantId: "t", siteId: "s", clusterId: null, companyId: null, version: null }, "c")).toThrow(/not linked/);
  });

  it("abbreviations are upper-case initials", () => {
    expect(abbreviationFor("Tenant A Retail")).toBe("TAR");
    expect(abbreviationFor("Murtaza")).toBe("MUR");
    expect(abbreviationFor("Shree Ganesh Cloth & Co.")).toBe("SGCC");
  });
});
