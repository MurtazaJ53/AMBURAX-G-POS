import { describe, expect, it } from "vitest";
import { buildGstInvoice, defaultGstAccounts, isInterState } from "@/server/erp/gstInvoice";

const accounts = defaultGstAccounts("MUR");
const SUPPLIER = "24ABCDE1234F1Z6"; // Gujarat

describe("GST on ERPNext invoices", () => {
  it("sends taxable values and CGST + SGST that add back to exactly what was paid", () => {
    // ₹1,049 incl. 5% (₹49.95 GST) x 1, and ₹1,180 incl. 18% (₹180) x 2 with ₹100 bill discount on line 2.
    const out = buildGstInvoice({
      supplierGstin: SUPPLIER,
      accounts,
      lines: [
        { variantId: "a", quantity: 1, unitPriceMinor: 104_900, lineDiscountMinor: 0, taxMinor: 4_995, lineTotalMinor: 104_900 },
        { variantId: "b", quantity: 2, unitPriceMinor: 118_000, lineDiscountMinor: 10_000, taxMinor: 34_476, lineTotalMinor: 236_000 },
      ],
    });
    const itemsMinor = out.items.reduce((s, i) => s + Math.round(i.rate * 100) * i.qty, 0);
    const taxMinor = out.taxes.reduce((s, t) => s + Math.round(t.tax_amount * 100), 0);
    expect(itemsMinor + taxMinor).toBe(104_900 + 236_000 - 10_000);
    expect(taxMinor).toBe(4_995 + 34_476);
    expect(out.taxes.map((t) => t.account_head)).toEqual(["Output Tax CGST - MUR", "Output Tax SGST - MUR"]);
    // An odd paisa goes to SGST, never lost.
    expect(out.taxes[1]!.tax_amount * 100 - out.taxes[0]!.tax_amount * 100).toBeCloseTo(1);
  });

  it("splits a line whose taxable value doesn't divide by the quantity, so qty x rate is exact", () => {
    const out = buildGstInvoice({
      supplierGstin: SUPPLIER,
      accounts,
      lines: [{ variantId: "c", quantity: 3, unitPriceMinor: 1_000, lineDiscountMinor: 0, taxMinor: 143, lineTotalMinor: 3_000 }],
    });
    // taxable 2,857 paise over 3 units → 1 unit at 9.53, 2 units at 9.52.
    expect(out.items).toEqual([
      { item_code: "c", qty: 1, rate: 9.53 },
      { item_code: "c", qty: 2, rate: 9.52 },
    ]);
  });

  it("uses IGST only for a business customer from another state, and no rows when there is no GST", () => {
    expect(isInterState(SUPPLIER, "27AAAAA0000A1Z5")).toBe(true);
    expect(isInterState(SUPPLIER, "24AAAAA0000A1Z5")).toBe(false);
    expect(isInterState(SUPPLIER, null)).toBe(false);
    const igst = buildGstInvoice({
      supplierGstin: SUPPLIER,
      customerGstin: "27AAAAA0000A1Z5",
      accounts,
      lines: [{ variantId: "d", quantity: 1, unitPriceMinor: 11_800, lineDiscountMinor: 0, taxMinor: 1_800, lineTotalMinor: 11_800 }],
    });
    expect(igst.taxes).toEqual([{ charge_type: "Actual", account_head: "Output Tax IGST - MUR", description: "IGST", tax_amount: 18 }]);
    const exempt = buildGstInvoice({
      supplierGstin: SUPPLIER,
      accounts,
      lines: [{ variantId: "e", quantity: 1, unitPriceMinor: 5_000, lineDiscountMinor: 0, taxMinor: 0, lineTotalMinor: 5_000 }],
    });
    expect(exempt.taxes).toEqual([]);
    expect(exempt.items).toEqual([{ item_code: "e", qty: 1, rate: 50 }]);
  });
});
