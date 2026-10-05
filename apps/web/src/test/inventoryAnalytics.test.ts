import { describe, expect, test } from "vitest";
import { StockMovementType } from "@prisma/client";
import {
  MOVEMENT_LABELS,
  buildCategoryRows,
  buildStockHealth,
  formatCount,
  formatMovementTime,
  formatSignedUnits,
  movementTone,
  wholePercents,
} from "@/components/inventory/InventoryAnalytics";
import { LOW_STOCK_MAX_UNITS } from "@/server/inventory/inventoryQueries";

/**
 * Inventory Part 5 — the arithmetic behind the stock insights band.
 *
 * The figures used here are the demo store's real ones, so a failure reads against numbers a
 * person has seen on screen: 9 categories with stock, the top five holding 1,287 of 1,678
 * units, and 105 SKUs split 66 / 30 / 9 with 2 of the 9 oversold.
 */

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

const DEMO_TOP_FIVE = [
  { name: "Activewear", count: 312 },
  { name: "Accessories", count: 283 },
  { name: "Kids", count: 240 },
  { name: "Shirts", count: 228 },
  { name: "Trousers", count: 224 },
];

describe("wholePercents", () => {
  test("always sums to exactly 100 when there is anything to share", () => {
    expect(sum(wholePercents([1, 1, 1]))).toBe(100);
    expect(sum(wholePercents([66, 30, 9]))).toBe(100);
    expect(sum(wholePercents([312, 283, 240, 228, 224, 391]))).toBe(100);
    expect(sum(wholePercents([1, 2, 3, 4, 5, 6, 7]))).toBe(100);
  });

  test("gives a third each to three equal shares, deterministically", () => {
    // 33.33 x3 floors to 99; the missing point goes to the earliest of the tied remainders.
    expect(wholePercents([1, 1, 1])).toEqual([34, 33, 33]);
  });

  test("never awards a point to a zero share", () => {
    expect(wholePercents([1, 0, 1])).toEqual([50, 0, 50]);
    expect(wholePercents([2, 0, 1])[1]).toBe(0);
  });

  test("returns zeros, not NaN, when the total is zero", () => {
    expect(wholePercents([0, 0, 0])).toEqual([0, 0, 0]);
    expect(wholePercents([])).toEqual([]);
  });
});

describe("buildCategoryRows — the Other remainder", () => {
  const rows = buildCategoryRows(DEMO_TOP_FIVE, 1678, 9);

  test("adds an Other row carrying exactly totalUnits minus the top five", () => {
    expect(rows).toHaveLength(6);
    const other = rows[5]!;
    expect(other.isOther).toBe(true);
    expect(other.name).toBe("Other");
    expect(other.units).toBe(1678 - 1287);
    expect(other.units).toBe(391);
  });

  test("names the hidden categories from categoryCount, not from a guess", () => {
    expect(rows[5]!.hiddenCategories).toBe(9 - 5);
    expect(rows.slice(0, 5).every((r) => r.hiddenCategories === null)).toBe(true);
  });

  test("displayed percentages sum to 100 once Other is included", () => {
    expect(sum(rows.map((r) => r.displayPct))).toBe(100);
  });

  test("bar widths are the exact share of totalUnits, with no multiplier", () => {
    expect(rows[0]!.sharePct).toBeCloseTo((312 / 1678) * 100, 10);
    expect(rows[5]!.sharePct).toBeCloseTo((391 / 1678) * 100, 10);
    expect(sum(rows.map((r) => r.sharePct))).toBeCloseTo(100, 10);
    expect(rows.every((r) => r.sharePct >= 0 && r.sharePct <= 100)).toBe(true);
  });

  test("shows no Other row when the top categories are all there is", () => {
    const three = [
      { name: "A", count: 50 },
      { name: "B", count: 30 },
      { name: "C", count: 20 },
    ];
    const r = buildCategoryRows(three, 100, 3);
    expect(r).toHaveLength(3);
    expect(r.some((x) => x.isOther)).toBe(false);
    expect(sum(r.map((x) => x.displayPct))).toBe(100);
  });

  test("says 'Other' without a count rather than print a wrong one when counts disagree", () => {
    const r = buildCategoryRows([{ name: "A", count: 60 }], 100, 1);
    expect(r[1]!.isOther).toBe(true);
    expect(r[1]!.units).toBe(40);
    expect(r[1]!.hiddenCategories).toBeNull();
  });

  test("a single hidden category is counted as one", () => {
    const r = buildCategoryRows([{ name: "A", count: 90 }], 100, 2);
    expect(r[1]!.hiddenCategories).toBe(1);
  });

  test("returns no rows, not NaN shares, when there is no stock", () => {
    expect(buildCategoryRows([], 0, 0)).toEqual([]);
    expect(buildCategoryRows(DEMO_TOP_FIVE, 0, 9)).toEqual([]);
  });
});

describe("buildStockHealth — SKU-count status", () => {
  const health = buildStockHealth({ inStock: 66, lowStock: 30, outOfStock: 9, oversold: 2 })!;

  test("derives shares from SKU counts, not from units", () => {
    expect(health.totalSkus).toBe(105);
    expect(health.segments.map((s) => s.count)).toEqual([66, 30, 9]);
    expect(health.segments[0]!.sharePct).toBeCloseTo((66 / 105) * 100, 10);
    expect(sum(health.segments.map((s) => s.sharePct))).toBeCloseTo(100, 10);
  });

  test("displayed percentages sum to 100 and are not the old hardcoded 70/20/10", () => {
    const pcts = health.segments.map((s) => s.displayPct);
    expect(sum(pcts)).toBe(100);
    expect(pcts).toEqual([63, 29, 8]);
    expect(pcts).not.toEqual([70, 20, 10]);
  });

  test("reports oversold as context and never subtracts it from out of stock", () => {
    expect(health.oversold).toBe(2);
    expect(health.segments[2]!.count).toBe(9);
  });

  test("labels low stock with the real threshold and nothing about reordering", () => {
    expect(health.segments[1]!.label).toBe(`Low (≤ ${LOW_STOCK_MAX_UNITS} units)`);
    expect(health.segments[1]!.label).toBe("Low (≤ 10 units)");
    expect(health.segments.map((s) => s.label).join(" ")).not.toMatch(/reorder|forecast/i);
  });

  test("builds its accessible summary from the runtime values", () => {
    expect(health.summary).toBe(
      "Stock status: 66 SKUs in stock, 30 low stock, 9 out of stock, including 2 oversold.",
    );
    const other = buildStockHealth({ inStock: 1, lowStock: 0, outOfStock: 4, oversold: 0 })!;
    expect(other.summary).toBe("Stock status: 1 SKU in stock, 0 low stock, 4 out of stock.");
  });

  test("returns null for an empty store instead of drawing 0 / 0", () => {
    expect(buildStockHealth({ inStock: 0, lowStock: 0, outOfStock: 0, oversold: 0 })).toBeNull();
  });
});

describe("movements", () => {
  test("labels exactly the movement types the schema defines", () => {
    expect(Object.keys(MOVEMENT_LABELS).sort()).toEqual(Object.values(StockMovementType).sort());
    expect(MOVEMENT_LABELS.SALE).toBe("Sale");
    expect(MOVEMENT_LABELS.OPENING_BALANCE).toBe("Opening balance");
    expect(Object.values(MOVEMENT_LABELS).every((l) => l !== l.toUpperCase())).toBe(true);
  });

  test("takes direction from the sign of the delta, not from the type", () => {
    expect(movementTone(5, 15)).toBe("in");
    expect(movementTone(-1, 4)).toBe("out");
    expect(movementTone(0, 4)).toBe("neutral");
  });

  test("reserves danger for a removal that left the balance below zero", () => {
    expect(movementTone(-1, -3)).toBe("oversold");
    // Receiving goods into a negative balance is still stock coming in.
    expect(movementTone(3, -1)).toBe("in");
  });

  test("formats signed quantities with the direction always visible", () => {
    expect(formatSignedUnits(5)).toBe("+5");
    expect(formatSignedUnits(-1)).toBe("-1");
    expect(formatSignedUnits(0)).toBe("0");
    expect(formatSignedUnits(1500)).toBe("+1,500");
  });
});

describe("formatting", () => {
  test("counts use Indian digit grouping", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(1678)).toBe("1,678");
    expect(formatCount(100000)).toBe("1,00,000");
    expect(formatCount(12345678)).toBe("1,23,45,678");
  });

  test("movement time is pinned to Asia/Kolkata, independent of the machine's timezone", () => {
    // 18:45 UTC on 3 Oct is 00:15 IST on 4 Oct: the date itself differs between the zones.
    const crossMidnight = new Date("2026-10-03T18:45:00.000Z");
    const opts: Intl.DateTimeFormatOptions = {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    };
    const ist = new Intl.DateTimeFormat("en-IN", { ...opts, timeZone: "Asia/Kolkata" });
    const utc = new Intl.DateTimeFormat("en-IN", { ...opts, timeZone: "UTC" });

    expect(formatMovementTime(crossMidnight)).toBe(ist.format(crossMidnight));
    expect(formatMovementTime(crossMidnight)).not.toBe(utc.format(crossMidnight));
    expect(formatMovementTime(crossMidnight)).toMatch(/04 Oct/);
    expect(formatMovementTime(crossMidnight)).toMatch(/12:15/);
  });

  test("a daytime IST movement keeps its own date", () => {
    expect(formatMovementTime(new Date("2026-10-03T11:29:20.054Z"))).toMatch(/03 Oct.*04:59/);
  });
});
