import { describe, expect, it } from "vitest";
import {
  computeSaleTotals,
  formatMinor,
  taxFromInclusive,
  validateQuantity,
  MAX_LINE_QUANTITY,
} from "@/server/sales/saleTotals";

/**
 * Money arithmetic is the one part of a POS that cannot be "mostly right". These tests
 * exist to pin the properties a till must never lose: integers only, tax extracted rather
 * than added, and quantities rejected rather than coerced.
 */

describe("validateQuantity", () => {
  it("accepts a positive integer", () => {
    expect(validateQuantity(1)).toBeNull();
    expect(validateQuantity(MAX_LINE_QUANTITY)).toBeNull();
  });

  it("rejects zero and negatives", () => {
    // A negative quantity would credit the customer through the checkout path, which is a
    // refund wearing a sale's clothes.
    expect(validateQuantity(0)).toBe("not_positive");
    expect(validateQuantity(-1)).toBe("not_positive");
  });

  it("rejects fractional quantities rather than rounding them", () => {
    expect(validateQuantity(1.5)).toBe("not_an_integer");
  });

  it("rejects values that are not finite numbers", () => {
    expect(validateQuantity(Number.NaN)).toBe("not_an_integer");
    expect(validateQuantity(Number.POSITIVE_INFINITY)).toBe("not_an_integer");
    expect(validateQuantity("2")).toBe("not_an_integer");
    expect(validateQuantity(null)).toBe("not_an_integer");
    expect(validateQuantity(undefined)).toBe("not_an_integer");
  });

  it("rejects an absurd quantity", () => {
    expect(validateQuantity(MAX_LINE_QUANTITY + 1)).toBe("too_large");
  });
});

describe("taxFromInclusive", () => {
  it("extracts tax from a tax-inclusive amount", () => {
    // 5% inclusive on ₹1050.00 -> net ₹1000.00, tax ₹50.00
    expect(taxFromInclusive(105_000, 500)).toBe(5_000);
  });

  it("returns zero for a zero rate or a zero amount", () => {
    expect(taxFromInclusive(105_000, 0)).toBe(0);
    expect(taxFromInclusive(0, 1800)).toBe(0);
  });

  it("never returns a fractional paisa", () => {
    const tax = taxFromInclusive(33_333, 1800);
    expect(Number.isInteger(tax)).toBe(true);
  });

  it("leaves the net amount recoverable", () => {
    const gross = 118_000;
    const tax = taxFromInclusive(gross, 1800);
    expect(gross - tax).toBe(100_000);
  });
});

describe("computeSaleTotals", () => {
  it("computes an empty cart as all zeroes", () => {
    const totals = computeSaleTotals([], 0, null, true);
    expect(totals).toMatchObject({
      subtotalMinor: 0,
      taxMinor: 0,
      discountMinor: 0,
      totalMinor: 0,
    });
    expect(totals.lines).toHaveLength(0);
  });

  it("multiplies quantity by unit price without floating point error", () => {
    const totals = computeSaleTotals([
      { variantId: "v1", quantity: 3, unitPriceMinor: 10, taxRateBp: 0 },
    ], 0, null, true);
    // 0.1 + 0.1 + 0.1 in floats is not 0.3; in paise it is exactly 30.
    expect(totals.totalMinor).toBe(30);
    expect(Number.isInteger(totals.totalMinor)).toBe(true);
  });

  it("keeps subtotal + tax equal to the total, which is what a receipt must show", () => {
    const totals = computeSaleTotals([
      { variantId: "v1", quantity: 2, unitPriceMinor: 129_900, taxRateBp: 500 },
      { variantId: "v2", quantity: 1, unitPriceMinor: 249_900, taxRateBp: 1200 },
    ], 0, null, true);
    expect(totals.subtotalMinor + totals.taxMinor).toBe(totals.totalMinor);
  });

  it("treats prices as tax-inclusive: the total is the sum of line prices", () => {
    const totals = computeSaleTotals([
      { variantId: "v1", quantity: 1, unitPriceMinor: 105_000, taxRateBp: 500 },
    ], 0, null, true);
    // Tax is contained in the price, not added to it.
    expect(totals.totalMinor).toBe(105_000);
    expect(totals.taxMinor).toBe(5_000);
    expect(totals.subtotalMinor).toBe(100_000);
  });

  it("rounds tax per line rather than once across the sale", () => {
    const line = { variantId: "v1", quantity: 1, unitPriceMinor: 333, taxRateBp: 1800 };
    const totals = computeSaleTotals([line, { ...line, variantId: "v2" }], 0, null, true);
    const perLine = taxFromInclusive(333, 1800);
    expect(totals.taxMinor).toBe(perLine * 2);
    // Each line on the printed bill adds up on its own.
    expect(totals.lines[0]?.taxMinor).toBe(perLine);
  });

  it("applies a whole-sale discount to the total", () => {
    const totals = computeSaleTotals(
      [{ variantId: "v1", quantity: 1, unitPriceMinor: 100_000, taxRateBp: 0 }],
      10_000,
      null,
      true,
    );
    expect(totals.discountMinor).toBe(10_000);
    expect(totals.totalMinor).toBe(90_000);
  });

  it("clamps a discount larger than the bill instead of producing a negative total", () => {
    // A negative total is a refund: different transaction, different accounting. The
    // checkout path must not be able to create one by accident.
    const totals = computeSaleTotals(
      [{ variantId: "v1", quantity: 1, unitPriceMinor: 100_000, taxRateBp: 0 }],
      500_000,
      null,
      true,
    );
    expect(totals.discountMinor).toBe(100_000);
    expect(totals.totalMinor).toBe(0);
  });

  it("ignores a negative discount", () => {
    const totals = computeSaleTotals(
      [{ variantId: "v1", quantity: 1, unitPriceMinor: 100_000, taxRateBp: 0 }],
      -50_000,
      null,
      true,
    );
    expect(totals.discountMinor).toBe(0);
    expect(totals.totalMinor).toBe(100_000);
  });

  it("produces integer amounts for every field", () => {
    const totals = computeSaleTotals([
      { variantId: "v1", quantity: 7, unitPriceMinor: 33_333, taxRateBp: 1800 },
    ], 0, null, true);
    for (const value of [
      totals.subtotalMinor,
      totals.taxMinor,
      totals.discountMinor,
      totals.totalMinor,
    ]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  describe("non-GST shop (isGstRegistered = false)", () => {
    it("forces tax to 0 and subtotal equals totalMinor", () => {
      const totals = computeSaleTotals(
        [
          { variantId: "v1", quantity: 2, unitPriceMinor: 100_000, taxRateBp: 1800 },
          { variantId: "v2", quantity: 1, unitPriceMinor: 50_000, taxRateBp: 500 },
        ],
        10_000,
        null,
        false, // non-GST shop
      );

      expect(totals.grossMinor).toBe(250_000);
      expect(totals.discountMinor).toBe(10_000);
      expect(totals.totalMinor).toBe(240_000);
      expect(totals.taxMinor).toBe(0);
      expect(totals.subtotalMinor).toBe(240_000);

      // Verify every line has taxRateBp 0 and taxMinor 0
      for (const line of totals.lines) {
        expect(line.taxRateBp).toBe(0);
        expect(line.taxMinor).toBe(0);
      }
    });

    it("GST registered shop calculates taxes normally", () => {
      const totals = computeSaleTotals(
        [{ variantId: "v1", quantity: 1, unitPriceMinor: 105_000, taxRateBp: 500 }],
        0,
        null,
        true, // GST shop
      );

      expect(totals.taxMinor).toBe(5_000);
      expect(totals.subtotalMinor).toBe(100_000);
      expect(totals.totalMinor).toBe(105_000);
    });
  });
});

describe("formatMinor", () => {
  it("renders paise as two decimal places", () => {
    expect(formatMinor(129_900)).toBe("₹1,299.00");
    expect(formatMinor(5)).toBe("₹0.05");
    expect(formatMinor(0)).toBe("₹0.00");
  });

  it("groups in the Indian convention", () => {
    expect(formatMinor(10_000_000)).toBe("₹1,00,000.00");
  });

  it("renders a negative amount with a leading sign", () => {
    expect(formatMinor(-12_345)).toBe("-₹123.45");
  });
});
