import { describe, it, expect } from "vitest";
import { assertInrCurrencyGuard, inrPricingPayload } from "@/server/erp/documentSync";
import { ErpError } from "@/server/erp/errors";

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
});
