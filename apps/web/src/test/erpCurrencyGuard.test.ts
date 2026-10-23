import { describe, it, expect, vi } from "vitest";
import { assertInrCurrencyGuard, inrPricingPayload } from "@/server/erp/documentSync";
import { ErpError } from "@/server/erp/errors";

const { mockSaleDb } = vi.hoisted(() => ({
  mockSaleDb: {
    sale: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
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

describe("ERP Currency Guard & Payload", () => {
  it("inrPricingPayload returns buying defaults", () => {
    const payload = inrPricingPayload("buying");
    expect(payload).toEqual({
      currency: "INR",
      conversion_rate: 1,
      plc_conversion_rate: 1,
      buying_price_list: "Standard Buying",
    });
  });

  it("inrPricingPayload returns selling defaults", () => {
    const payload = inrPricingPayload("selling");
    expect(payload).toEqual({
      currency: "INR",
      conversion_rate: 1,
      plc_conversion_rate: 1,
      selling_price_list: "Standard Selling",
    });
  });

  it("inrPricingPayload accepts custom price list", () => {
    const payload = inrPricingPayload("buying", "Custom Buying List");
    expect(payload).toEqual({
      currency: "INR",
      conversion_rate: 1,
      plc_conversion_rate: 1,
      buying_price_list: "Custom Buying List",
    });
  });

  it("throws currency_mismatch when Purchase Receipt has plc_conversion_rate = 95.02", () => {
    const doc = {
      name: "MAT-PRE-2026-00005",
      currency: "INR",
      conversion_rate: 1,
      price_list_currency: "USD",
      plc_conversion_rate: 95.02,
    };

    expect(() =>
      assertInrCurrencyGuard("Purchase Receipt", "MAT-PRE-2026-00005", doc, "test-corr-1")
    ).toThrowError(ErpError);

    try {
      assertInrCurrencyGuard("Purchase Receipt", "MAT-PRE-2026-00005", doc, "test-corr-1");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ErpError);
      const erpErr = err as ErpError;
      expect(erpErr.kind).toBe("currency_mismatch");
      expect(erpErr.message).toContain("failed currency guard");
      expect(erpErr.message).toContain("95.02");
    }
  });

  it("throws currency_mismatch when Sales Invoice has currency = USD", () => {
    const doc = {
      name: "ACC-SINV-2026-00001",
      currency: "USD",
      conversion_rate: 1,
      price_list_currency: "USD",
      plc_conversion_rate: 1,
    };

    expect(() =>
      assertInrCurrencyGuard("Sales Invoice", "ACC-SINV-2026-00001", doc, "test-corr-2")
    ).toThrowError(ErpError);

    try {
      assertInrCurrencyGuard("Sales Invoice", "ACC-SINV-2026-00001", doc, "test-corr-2");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ErpError);
      const erpErr = err as ErpError;
      expect(erpErr.kind).toBe("currency_mismatch");
      expect(erpErr.message).toContain("currency=USD");
    }
  });

  it("throws special return message when Sales Invoice return inherits USD", () => {
    const doc = {
      name: "ACC-SINV-2026-00002",
      currency: "USD",
      conversion_rate: 1,
      price_list_currency: "USD",
      plc_conversion_rate: 1,
    };

    try {
      assertInrCurrencyGuard("Sales Invoice", "ACC-SINV-2026-00002", doc, "test-corr-3", true);
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ErpError);
      const erpErr = err as ErpError;
      expect(erpErr.kind).toBe("currency_mismatch");
      expect(erpErr.message).toContain("Return inherited currency=USD from an original USD-labelled invoice");
    }
  });

  it("passes when Purchase Receipt is strictly INR and 1.0 rates", () => {
    const doc = {
      name: "MAT-PRE-2026-00999",
      currency: "INR",
      conversion_rate: 1,
      price_list_currency: "INR",
      plc_conversion_rate: 1,
    };

    expect(() =>
      assertInrCurrencyGuard("Purchase Receipt", "MAT-PRE-2026-00999", doc, "test-corr-4")
    ).not.toThrow();
  });

  it("passes for Stock Entry without throwing (Stock Entry is not currency-guarded)", () => {
    const doc = {
      name: "STE-2026-00001",
      stock_entry_type: "Material Transfer",
      // Stock Entry has no currency or price list fields
    };

    expect(() =>
      assertInrCurrencyGuard("Stock Entry", "STE-2026-00001", doc, "test-corr-5")
    ).not.toThrow();
  });

  it("findDocumentName throws currency_mismatch if found document is a draft with invalid currency", async () => {
    const { findDocumentName } = await import("@/server/erp/documentSync");
    const mockClient = {
      call: async () => ({
        status: 200,
        body: {
          data: [
            {
              name: "ACC-SINV-2026-DRAFT-USD",
              docstatus: 0,
              currency: "USD",
              conversion_rate: 1,
            },
          ],
        },
      }),
    };

    await expect(
      findDocumentName(
        mockClient as any,
        { siteId: "test", tenantId: "t1", clusterId: null, companyId: "C1", version: null },
        { tenantId: "t1", correlationId: "c1" },
        "Sales Invoice",
        "amburax_sale_id",
        "sale-1"
      )
    ).rejects.toThrowError(ErpError);
  });

  it("ensures that when assertInrCurrencyGuard fails, submit PUT is never called in createDocument", async () => {
    const { createDocument } = await import("@/server/erp/documentSync");
    const calls: Array<{ method: string; path: string }> = [];
    const mockClient = {
      call: async (_env: any, _ctx: any, req: { method: string; path: string }) => {
        calls.push({ method: req.method, path: req.path });
        if (req.method === "POST") {
          return {
            status: 200,
            body: {
              data: {
                name: "MAT-PRE-INVALID-USD",
                currency: "USD",
                conversion_rate: 1,
              },
            },
          };
        }
        return { status: 200, body: {} };
      },
    };

    await expect(
      createDocument(
        mockClient as any,
        { siteId: "test", tenantId: "t1", clusterId: null, companyId: "C1", version: null },
        { tenantId: "t1", correlationId: "c1" },
        "Purchase Receipt",
        { supplier: "Test", items: [] },
        "idemp-1",
        true
      )
    ).rejects.toThrowError(ErpError);

    // Verify POST was called to create the draft, but submit PUT was NEVER called
    expect(calls.some((c) => c.method === "POST")).toBe(true);
    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("erpDate and erpTime convert UTC moments to IST correctly", async () => {
    const { erpDate, erpTime } = await import("@/server/erp/documentSync");
    // 2025-04-21 18:00:00 UTC = 2025-04-21 23:30:00 IST (late night sale on same IST day)
    const lateNightSaleUtc = new Date("2025-04-21T18:00:00.000Z");
    expect(erpDate(lateNightSaleUtc)).toBe("2025-04-21");
    expect(erpTime(lateNightSaleUtc)).toBe("23:30:00");

    // 2025-04-21 18:35:00 UTC = 2025-04-22 00:05:00 IST (rolls past midnight IST)
    const afterMidnightUtc = new Date("2025-04-21T18:35:00.000Z");
    expect(erpDate(afterMidnightUtc)).toBe("2025-04-22");
    expect(erpTime(afterMidnightUtc)).toBe("00:05:00");
  });

  it("sale sync passes posting_date and posting_time in IST through draft-then-submit flow", async () => {
    const { ErpSaleAdapter } = await import("@/server/erp/saleAdapter");
    const saleTimestamp = new Date("2025-04-21T18:00:00.000Z"); // 23:30 IST

    const sentRequests: Array<{ method: string; path: string; body?: any }> = [];
    const mockTransport = {
      send: vi.fn().mockImplementation(async (req: any) => {
        sentRequests.push({ method: req.method, path: req.path, body: req.body });
        if (req.method === "GET" && req.path.includes("Sales%20Invoice")) {
          // Idempotency lookup returns no existing
          return { status: 200, body: { data: [] } };
        }
        if (req.method === "GET" && req.path.includes("Warehouse")) {
          return { status: 200, body: { data: { company: "Shree Krishna Fashion" } } };
        }
        if (req.method === "POST" && req.path === "/api/resource/Sales Invoice") {
          return {
            status: 200,
            body: {
              data: {
                name: "ACC-SINV-2025-TEST",
                docstatus: 0,
                currency: "INR",
                conversion_rate: 1,
                price_list_currency: "INR",
                plc_conversion_rate: 1,
                posting_date: req.body.posting_date,
                posting_time: req.body.posting_time,
              },
            },
          };
        }
        if (req.method === "PUT") {
          return { status: 200, body: { data: { name: "ACC-SINV-2025-TEST", docstatus: 1 } } };
        }
        return { status: 200, body: {} };
      }),
    };

    const adapter = new ErpSaleAdapter(mockTransport as any);
    (adapter as any).client = {
      call: async (_env: any, _ctx: any, req: any) => mockTransport.send(req),
    };

    mockSaleDb.sale.findUnique.mockResolvedValue({
      id: "sale-late-night-1",
      completedAt: saleTimestamp,
      createdAt: saleTimestamp,
      erpSyncStatus: "PENDING",
      storeId: "store-1",
      store: {
        erpnextWarehouseId: "Stores - SKF",
        company: { code: "SKF" },
      },
      items: [
        { variantId: "var-1", quantity: 2, unitPriceMinor: 50000, discountMinor: 0, taxAmountMinor: 0 },
      ],
      payments: [
        { method: "CASH", amountMinor: 100000 },
      ],
      tenant: { taxId: null },
      discountMinor: 0,
    });
    mockSaleDb.sale.update.mockResolvedValue({});

    await adapter.syncSale("t1", "sale-late-night-1", "corr-test");

    const postCall = sentRequests.find((r) => r.method === "POST" && r.path === "/api/resource/Sales Invoice");
    expect(postCall).toBeDefined();
    expect(postCall!.body.posting_date).toBe("2025-04-21");
    expect(postCall!.body.posting_time).toBe("23:30:00");
    expect(postCall!.body.set_posting_time).toBe(1);

    const putCall = sentRequests.find((r) => r.method === "PUT" && r.path.includes("ACC-SINV-2025-TEST"));
    expect(putCall).toBeDefined();
    expect(putCall!.body.docstatus).toBe(1);
  });

  it("ignores cancelled Sales Invoices (docstatus: 2) in lookup and creates a new one", async () => {
    const { ErpSaleAdapter } = await import("@/server/erp/saleAdapter");
    const adapter = new ErpSaleAdapter({} as any);

    const mockClient = {
      call: vi.fn().mockResolvedValue({
        status: 200,
        body: {
          data: [
            {
              name: "ACC-SINV-CANCELLED-1",
              docstatus: 2, // Cancelled
              currency: "INR",
              conversion_rate: 1,
            },
          ],
        },
      }),
    };
    (adapter as any).client = mockClient;

    const res = await (adapter as any).lookupInvoiceBySaleId(
      { siteId: "test", tenantId: "t1" },
      "t1",
      "sale-repost-1",
      "corr-test"
    );

    // Cancelled invoice must be ignored (returns null) so fresh invoice is created
    expect(res).toBeNull();
  });

  it("return sync uses return's own timestamp for posting_date and posting_time", async () => {
    const { ErpReturnAdapter } = await import("@/server/erp/returnAdapter");
    const returnTimestamp = new Date("2025-05-10T14:30:00.000Z"); // 20:00 IST

    const mockDbReturn = {
      saleReturn: {
        findUnique: vi.fn().mockResolvedValue({
          id: "ret-1",
          createdAt: returnTimestamp,
          erpSyncStatus: "PENDING",
          storeId: "store-1",
          originalSaleId: "orig-sale-1",
          originalSale: {
            erpInvoiceId: "ACC-SINV-ORIG-1",
            customerId: null,
            store: { erpnextWarehouseId: "Stores - SKF" },
            tenant: { taxId: null },
          },
          items: [
            { originalSaleItem: { variantId: "var-1", unitPriceMinor: 50000 }, quantity: 1 },
          ],
          payments: [
            { method: "CASH", amountMinor: 50000 },
          ],
        }),
        update: vi.fn().mockResolvedValue({}),
      },
    };

    const sentRequests: Array<{ method: string; path: string; body?: any }> = [];
    const mockClient = {
      call: vi.fn().mockImplementation(async (_env: any, _ctx: any, req: any) => {
        sentRequests.push({ method: req.method, path: req.path, body: req.body });
        if (req.method === "GET" && req.path.includes("Sales%20Invoice")) {
          return { status: 200, body: { data: [] } };
        }
        if (req.method === "GET" && req.path.includes("Warehouse")) {
          return { status: 200, body: { data: { company: "Shree Krishna Fashion" } } };
        }
        if (req.method === "POST") {
          return {
            status: 200,
            body: {
              data: {
                name: "ACC-SINV-RET-TEST",
                docstatus: 0,
                currency: "INR",
                conversion_rate: 1,
                price_list_currency: "INR",
                plc_conversion_rate: 1,
              },
            },
          };
        }
        return { status: 200, body: {} };
      }),
    };

    const returnAdapter = new ErpReturnAdapter({} as any);
    (returnAdapter as any).client = mockClient;

    // Test directly lookupReturnInvoiceByReturnId with cancelled doc
    mockClient.call.mockResolvedValueOnce({
      status: 200,
      body: {
        data: [{ name: "ACC-SINV-CANCELLED-RET", docstatus: 2 }],
      },
    });

    const res = await (returnAdapter as any).lookupReturnInvoiceByReturnId(
      { siteId: "test", tenantId: "t1" },
      "t1",
      "ret-1",
      "corr-test"
    );
    expect(res).toBeNull();
  });

  it("cancel -> re-sync -> new invoice created, while cancelled document is retained", async () => {
    const { ErpSaleAdapter } = await import("@/server/erp/saleAdapter");
    const saleTimestamp = new Date("2025-04-21T18:00:00.000Z"); // 23:30 IST

    const sentRequests: Array<{ method: string; path: string; body?: any }> = [];
    const mockTransport = {
      send: vi.fn().mockImplementation(async (req: any) => {
        sentRequests.push({ method: req.method, path: req.path, body: req.body });
        if (req.method === "GET" && req.path.includes("Sales%20Invoice")) {
          // ERPNext returns BOTH the old cancelled invoice and NO active draft/submitted invoice
          return {
            status: 200,
            body: {
              data: [
                {
                  name: "ACC-SINV-CANCELLED-100",
                  docstatus: 2, // Cancelled
                  amburax_sale_id: "sale-cancelled-resync-1",
                  currency: "INR",
                  conversion_rate: 1,
                },
              ],
            },
          };
        }
        if (req.method === "GET" && req.path.includes("Warehouse")) {
          return { status: 200, body: { data: { company: "Shree Krishna Fashion" } } };
        }
        if (req.method === "POST" && req.path === "/api/resource/Sales Invoice") {
          return {
            status: 200,
            body: {
              data: {
                name: "ACC-SINV-NEW-101",
                docstatus: 0,
                currency: "INR",
                conversion_rate: 1,
                price_list_currency: "INR",
                plc_conversion_rate: 1,
                posting_date: req.body.posting_date,
                posting_time: req.body.posting_time,
              },
            },
          };
        }
        if (req.method === "PUT" && req.path.includes("ACC-SINV-NEW-101")) {
          return { status: 200, body: { data: { name: "ACC-SINV-NEW-101", docstatus: 1 } } };
        }
        return { status: 200, body: {} };
      }),
    };

    const adapter = new ErpSaleAdapter(mockTransport as any);
    (adapter as any).client = {
      call: async (_env: any, _ctx: any, req: any) => mockTransport.send(req),
    };

    mockSaleDb.sale.findUnique.mockResolvedValue({
      id: "sale-cancelled-resync-1",
      completedAt: saleTimestamp,
      createdAt: saleTimestamp,
      erpSyncStatus: "PENDING",
      storeId: "store-1",
      store: {
        erpnextWarehouseId: "Stores - SKF",
        company: { code: "SKF" },
      },
      items: [
        { variantId: "var-1", quantity: 1, unitPriceMinor: 25000, discountMinor: 0, taxAmountMinor: 0 },
      ],
      payments: [
        { method: "CASH", amountMinor: 25000 },
      ],
      tenant: { taxId: null },
      discountMinor: 0,
    });
    mockSaleDb.sale.update.mockResolvedValue({});

    // Trigger re-sync on a sale that was previously cancelled in ERPNext
    await adapter.syncSale("t1", "sale-cancelled-resync-1", "corr-resync-1");

    // Assert that a fresh invoice was created and submitted without mutating or deleting the cancelled invoice
    const postCall = sentRequests.find((r) => r.method === "POST" && r.path === "/api/resource/Sales Invoice");
    expect(postCall).toBeDefined();
    expect(postCall!.body.amburax_sale_id).toBe("sale-cancelled-resync-1");

    const putCall = sentRequests.find((r) => r.method === "PUT" && r.path.includes("ACC-SINV-NEW-101"));
    expect(putCall).toBeDefined();
    expect(putCall!.body.docstatus).toBe(1);

    // Verify no DELETE calls were made against ERPNext
    expect(sentRequests.some((r) => r.method === "DELETE")).toBe(false);
  });
});
