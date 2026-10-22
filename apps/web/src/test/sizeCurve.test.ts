import { describe, it, expect } from "vitest";
import {
  computeStoreSizeCurve,
  recommendSizePackAllocation,
  type SizeSalesData,
} from "@/server/ai/sizeCurve";

describe("Size-Curve Optimization Engine (Line 54)", () => {
  const salesHistory: SizeSalesData[] = [
    { size: "S", unitsSold: 50, stockoutDays: 0, currentStock: 30 },
    { size: "M", unitsSold: 150, stockoutDays: 0, currentStock: 20 }, // High sales (30%), low stock
    { size: "L", unitsSold: 200, stockoutDays: 0, currentStock: 15 }, // High sales (40%), very low stock -> UNDERSTOCKED
    { size: "XL", unitsSold: 75, stockoutDays: 0, currentStock: 25 },
    { size: "XXL", unitsSold: 25, stockoutDays: 0, currentStock: 50 }, // Low sales (5%), high stock (35%) -> OVERSTOCKED
  ];

  it("computes size velocity curve and flags understocked vs overstocked sizes", () => {
    const curve = computeStoreSizeCurve({
      storeId: "store_surat",
      category: "Men Formal Shirts",
      historicalSales: salesHistory,
    });

    expect(curve.totalHistoricalUnits).toBe(500);
    // S: 50/500 = 10%
    expect(curve.ratios["S"]).toBe(0.1);
    // L: 200/500 = 40%
    expect(curve.ratios["L"]).toBe(0.4);

    const lImbalance = curve.imbalances.find(i => i.size === "L");
    expect(lImbalance?.status).toBe("UNDERSTOCKED_RISK");

    const xxlImbalance = curve.imbalances.find(i => i.size === "XXL");
    expect(xxlImbalance?.status).toBe("OVERSTOCKED_RISK");
  });

  it("allocates purchase order units according to the store's exact size curve", () => {
    const curve = computeStoreSizeCurve({
      storeId: "store_surat",
      category: "Men Formal Shirts",
      historicalSales: salesHistory,
    });

    const allocation = recommendSizePackAllocation(curve, 100);
    expect(allocation["S"]).toBe(10);
    expect(allocation["M"]).toBe(30);
    expect(allocation["L"]).toBe(40);
    expect(allocation["XL"]).toBe(15);
    expect(allocation["XXL"]).toBe(5);

    const totalAllocated = Object.values(allocation).reduce((a, b) => a + b, 0);
    expect(totalAllocated).toBe(100);
  });
});
