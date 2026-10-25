import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Re-syncing a sale or return whose ERPNext invoice was cancelled. ERPNext keeps
 * `amburax_sale_id` unique, so the cancelled invoice's id is renamed to "<id>-CANCELLED-<n>"
 * first; if that cannot be confirmed, nothing new is created.
 */

vi.mock("@/server/db", () => ({ db: {} }));

const { FakeErpTransport } = await import("@/server/erp/fakeTransport");
const { newErpClient, retireCancelledTrackingId, RETIRE_CANCELLED_METHOD } = await import("@/server/erp/documentSync");
const { ErpSaleAdapter } = await import("@/server/erp/saleAdapter");
const { ErpReturnAdapter } = await import("@/server/erp/returnAdapter");
const { ErpError } = await import("@/server/erp/errors");

const ENV = { tenantId: "tenant-1", siteId: "test-site.local", clusterId: null, companyId: "Acme Fashion", version: null };
const CTX = { tenantId: "tenant-1", correlationId: "corr-1" };
const ID = "sale-abc";

interface FakeInvoice { name: string; docstatus: number; amburax_sale_id: string }

/** A tiny ERPNext: Sales Invoices with a unique amburax_sale_id and the rename method. */
function erp(invoices: FakeInvoice[], opts: { renameStatus?: number; renameDoesNothing?: boolean } = {}) {
  const t = new FakeErpTransport();
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  t.send = async (req) => {
    const path = decodeURIComponent(req.path);
    calls.push({ method: req.method, path, body: req.body });
    if (req.method === "POST" && path === RETIRE_CANCELLED_METHOD) {
      if (opts.renameStatus) return { status: opts.renameStatus, body: { exc_type: "DoesNotExistError" } };
      const b = req.body as { name: string; value: string };
      const doc = invoices.find((i) => i.name === b.name);
      if (doc && !opts.renameDoesNothing) doc.amburax_sale_id = b.value;
      return { status: 200, body: {} };
    }
    if (req.method === "POST" && path === "/api/resource/Sales Invoice") {
      return { status: 500, body: { message: "test must not create invoices" } };
    }
    const one = path.match(/^\/api\/resource\/Sales Invoice\/([^?]+)$/);
    if (one) {
      const doc = invoices.find((i) => i.name === one[1]);
      return doc ? { status: 200, body: { data: doc } } : { status: 404, body: {} };
    }
    if (path.startsWith("/api/resource/Sales Invoice?")) {
      const filters = JSON.parse(new URLSearchParams(path.split("?")[1]).get("filters") ?? "[]") as Array<[string, string, string]>;
      const [, op, value] = filters[0]!;
      const rows = invoices.filter((i) =>
        op === "like" ? i.amburax_sale_id.startsWith(value.replace(/%$/, "")) : i.amburax_sale_id === value,
      );
      return { status: 200, body: { data: rows } };
    }
    return { status: 404, body: {} };
  };
  return { t, calls, renames: () => calls.filter((c) => c.path === RETIRE_CANCELLED_METHOD) };
}

beforeEach(() => {
  process.env["ERP_SITE_TEST_SITE_LOCAL_URL"] = "http://test-site.local";
  process.env["ERP_SITE_TEST_SITE_LOCAL_KEY"] = "test-key";
  process.env["ERP_SITE_TEST_SITE_LOCAL_SECRET"] = "test-secret";
});

describe("retireCancelledTrackingId", () => {
  it("renames to -CANCELLED-1, confirms by reading it back, and returns the new id", async () => {
    const invoices = [{ name: "SINV-1", docstatus: 2, amburax_sale_id: ID }];
    const { t, renames } = erp(invoices);
    const value = await retireCancelledTrackingId(newErpClient(t), ENV, CTX, {
      doctype: "Sales Invoice", fieldname: "amburax_sale_id", docName: "SINV-1", baseId: ID,
    });
    expect(value).toBe(`${ID}-CANCELLED-1`);
    expect(renames()[0]!.body).toEqual({ doctype: "Sales Invoice", name: "SINV-1", fieldname: "amburax_sale_id", base_id: ID, value });
    expect(invoices[0]!.amburax_sale_id).toBe(value);
  });

  it("takes the next free number after earlier cancellations", async () => {
    const invoices = [
      { name: "SINV-1", docstatus: 2, amburax_sale_id: `${ID}-CANCELLED-1` },
      { name: "SINV-2", docstatus: 2, amburax_sale_id: `${ID}-CANCELLED-3` },
      { name: "SINV-3", docstatus: 2, amburax_sale_id: ID },
    ];
    const { t } = erp(invoices);
    const value = await retireCancelledTrackingId(newErpClient(t), ENV, CTX, {
      doctype: "Sales Invoice", fieldname: "amburax_sale_id", docName: "SINV-3", baseId: ID,
    });
    expect(value).toBe(`${ID}-CANCELLED-4`);
  });

  it("stops with a clear error when the rename method is not installed", async () => {
    const { t } = erp([{ name: "SINV-1", docstatus: 2, amburax_sale_id: ID }], { renameStatus: 404 });
    const err = await retireCancelledTrackingId(newErpClient(t), ENV, CTX, {
      doctype: "Sales Invoice", fieldname: "amburax_sale_id", docName: "SINV-1", baseId: ID,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ErpError);
    expect((err as InstanceType<typeof ErpError>).kind).toBe("configuration_error");
    expect((err as Error).message).toMatch(/amburax_retire_cancelled_id installed.*No new Sales Invoice was created/);
  });

  it("stops when the document does not read back with the new id", async () => {
    const { t } = erp([{ name: "SINV-1", docstatus: 2, amburax_sale_id: ID }], { renameDoesNothing: true });
    const err = await retireCancelledTrackingId(newErpClient(t), ENV, CTX, {
      doctype: "Sales Invoice", fieldname: "amburax_sale_id", docName: "SINV-1", baseId: ID,
    }).catch((e: unknown) => e);
    expect((err as InstanceType<typeof ErpError>).kind).toBe("conflict");
    expect((err as Error).message).toMatch(/still reads amburax_sale_id=sale-abc/);
  });
});

describe.each([
  ["sale", (t: InstanceType<typeof FakeErpTransport>) => new ErpSaleAdapter(t), "lookupInvoiceBySaleId"],
  ["return", (t: InstanceType<typeof FakeErpTransport>) => new ErpReturnAdapter(t), "lookupReturnInvoiceByReturnId"],
] as const)("%s adapter lookup of a cancelled invoice", (_label, make, lookup) => {
  type Lookup = (env: typeof ENV, tenantId: string, id: string, correlationId: string) => Promise<unknown>;

  it("renames the cancelled invoice and reports none, so a new one is created with the original id", async () => {
    const invoices = [{ name: "SINV-9", docstatus: 2, amburax_sale_id: ID }];
    const { t, renames } = erp(invoices);
    const adapter = make(t) as unknown as Record<string, Lookup>;
    await expect(adapter[lookup]!.call(adapter, ENV, "tenant-1", ID, "corr-1")).resolves.toBeNull();
    expect(renames()).toHaveLength(1);
    expect(invoices[0]!.amburax_sale_id).toBe(`${ID}-CANCELLED-1`);
  });

  it("fails the sync instead of returning none when the rename fails, so no duplicate is created", async () => {
    const { t, calls } = erp([{ name: "SINV-9", docstatus: 2, amburax_sale_id: ID }], { renameStatus: 404 });
    const adapter = make(t) as unknown as Record<string, Lookup>;
    await expect(adapter[lookup]!.call(adapter, ENV, "tenant-1", ID, "corr-1")).rejects.toThrow(/No new Sales Invoice was created/);
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/resource/Sales Invoice")).toBe(false);
  });

  it("leaves an active invoice alone", async () => {
    const { t, renames } = erp([{ name: "SINV-9", docstatus: 1, amburax_sale_id: ID }]);
    const adapter = make(t) as unknown as Record<string, Lookup>;
    await expect(adapter[lookup]!.call(adapter, ENV, "tenant-1", ID, "corr-1")).resolves.toMatchObject({ name: "SINV-9", docstatus: 1 });
    expect(renames()).toHaveLength(0);
  });
});
