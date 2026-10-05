import { describe, expect, test } from "vitest";
import {
  LOW_STOCK_MAX_UNITS,
  stockStatusLabel,
  stockStatusQuantityFilter,
} from "@/server/inventory/inventoryQueries";

/**
 * Inventory Part 3 — the status filter and the row pills read the same bands as the overview
 * counts: in stock above LOW_STOCK_MAX_UNITS, low from 1 to LOW_STOCK_MAX_UNITS, out at zero
 * or below (oversold included).
 */

/** Whether a quantity satisfies a Prisma-style { gt, lte } condition. */
function matches(filter: { gt?: number; lte?: number }, quantity: number): boolean {
  if (filter.gt !== undefined && !(quantity > filter.gt)) return false;
  if (filter.lte !== undefined && !(quantity <= filter.lte)) return false;
  return true;
}

const SAMPLE = [-5, -1, 0, 1, 2, 9, 10, 11, 12, 500];

describe("stockStatusQuantityFilter", () => {
  test("In Stock is strictly above the low-stock threshold", () => {
    const f = stockStatusQuantityFilter("in_stock")!;
    expect(f).toEqual({ gt: LOW_STOCK_MAX_UNITS });
    expect(SAMPLE.filter((q) => matches(f, q))).toEqual([11, 12, 500]);
    expect(matches(f, LOW_STOCK_MAX_UNITS)).toBe(false);
  });

  test("Low Stock is 1 through the threshold, inclusive", () => {
    const f = stockStatusQuantityFilter("low_stock")!;
    expect(f).toEqual({ gt: 0, lte: LOW_STOCK_MAX_UNITS });
    expect(SAMPLE.filter((q) => matches(f, q))).toEqual([1, 2, 9, 10]);
  });

  test("Out of Stock is zero and every oversold balance", () => {
    const f = stockStatusQuantityFilter("out_of_stock")!;
    expect(f).toEqual({ lte: 0 });
    expect(SAMPLE.filter((q) => matches(f, q))).toEqual([-5, -1, 0]);
  });

  test("the three bands partition every quantity exactly once", () => {
    const bands = ["in_stock", "low_stock", "out_of_stock"].map((s) => stockStatusQuantityFilter(s)!);
    for (let q = -20; q <= 40; q++) {
      expect(bands.filter((b) => matches(b, q))).toHaveLength(1);
    }
  });

  test("no status, or an unknown one, applies no quantity filter", () => {
    expect(stockStatusQuantityFilter(undefined)).toBeUndefined();
    expect(stockStatusQuantityFilter("")).toBeUndefined();
    expect(stockStatusQuantityFilter("reorder")).toBeUndefined();
  });
});

describe("stockStatusLabel agrees with the filter", () => {
  test("labels each band by the same boundaries", () => {
    expect(stockStatusLabel(11)).toBe("In Stock");
    expect(stockStatusLabel(10)).toBe("Low Stock");
    expect(stockStatusLabel(1)).toBe("Low Stock");
    expect(stockStatusLabel(0)).toBe("Out of Stock");
    expect(stockStatusLabel(-3)).toBe("Negative");
  });

  test("a row the In Stock filter returns is never pilled Low Stock", () => {
    const inStock = stockStatusQuantityFilter("in_stock")!;
    const low = stockStatusQuantityFilter("low_stock")!;
    const out = stockStatusQuantityFilter("out_of_stock")!;
    for (let q = -20; q <= 40; q++) {
      const label = stockStatusLabel(q);
      if (matches(inStock, q)) expect(label).toBe("In Stock");
      if (matches(low, q)) expect(label).toBe("Low Stock");
      if (matches(out, q)) expect(["Out of Stock", "Negative"]).toContain(label);
    }
  });
});
