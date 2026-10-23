import { describe, expect, it } from "vitest";
import {
  allocateDiscount,
  apparelSlabRateBp,
  computeSaleTotals,
  type ApparelSlab,
} from "@/server/sales/saleTotals";

/** Owner decisions 2026-10-13: garment slab 5% <= Rs 2,500 per piece, 18% above; bill discounts. */
const SLAB: ApparelSlab = { thresholdMinor: 250_000, lowRateBp: 500, highRateBp: 1_800 };

describe("apparelSlabRateBp", () => {
  it("uses the low rate up to Rs 2,500 excluding GST, i.e. Rs 2,625 inclusive, per piece", () => {
    expect(apparelSlabRateBp(262_500, 1, SLAB)).toBe(500);
    expect(apparelSlabRateBp(262_501, 1, SLAB)).toBe(1_800);
    expect(apparelSlabRateBp(100_000, 1, SLAB)).toBe(500);
  });

  it("judges each piece, not the line", () => {
    // Three pieces at Rs 2,000 each: Rs 6,000 on the line but each piece is in the low slab.
    expect(apparelSlabRateBp(600_000, 3, SLAB)).toBe(500);
  });
});

describe("allocateDiscount", () => {
  it("splits in proportion and always sums to the discount", () => {
    expect(allocateDiscount([100_000, 50_000], 15_000)).toEqual([10_000, 5_000]);
    const parts = allocateDiscount([33_333, 33_333, 33_334], 100);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("gives nothing when there is no discount", () => {
    expect(allocateDiscount([1_000, 2_000], 0)).toEqual([0, 0]);
  });
});

describe("computeSaleTotals with discount and slab", () => {
  it("is unchanged from before when there is no discount and no slab", () => {
    const t = computeSaleTotals([{ variantId: "a", quantity: 2, unitPriceMinor: 105_000, taxRateBp: 500 }], 0, null, true);
    expect(t.totalMinor).toBe(210_000);
    expect(t.taxMinor).toBe(10_000);
    expect(t.subtotalMinor).toBe(200_000);
    expect(t.lines[0]!.lineDiscountMinor).toBe(0);
  });

  it("extracts GST from the discounted amount", () => {
    const t = computeSaleTotals([{ variantId: "a", quantity: 1, unitPriceMinor: 105_000, taxRateBp: 500 }], 10_500, null, true);
    expect(t.totalMinor).toBe(94_500);
    expect(t.taxMinor).toBe(4_500);
    expect(t.subtotalMinor).toBe(90_000);
    expect(t.lines[0]!.lineDiscountMinor).toBe(10_500);
  });

  it("a discount can move a garment from the 18% slab into the 5% slab", () => {
    const line = {
      variantId: "a",
      quantity: 1,
      unitPriceMinor: 280_000,
      taxRateBp: 1_800,
      taxRateMode: "APPAREL_SLAB" as const,
    };
    expect(computeSaleTotals([line], 0, SLAB, true).lines[0]!.taxRateBp).toBe(1_800);
    const discounted = computeSaleTotals([line], 20_000, SLAB, true);
    expect(discounted.lines[0]!.taxRateBp).toBe(500);
    expect(discounted.taxMinor).toBe(Math.round((260_000 * 500) / 10_500));
  });

  it("leaves FIXED lines on their stored rate even when a slab is supplied", () => {
    const t = computeSaleTotals([{ variantId: "a", quantity: 1, unitPriceMinor: 500_000, taxRateBp: 1_200 }], 0, SLAB, true);
    expect(t.lines[0]!.taxRateBp).toBe(1_200);
  });
});
