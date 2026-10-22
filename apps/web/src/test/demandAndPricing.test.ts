import { describe, it, expect } from "vitest";
import {
  calculateWeightedDailyVelocity,
  forecastProductDemand,
  type SalesHistoryPoint,
} from "@/server/ai/demandForecasting";
import {
  evaluateDynamicPricingRules,
  type InventoryAgingFact,
} from "@/server/pricing/dynamicPricing";

describe("Demand Forecasting & Dynamic Markdown Pricing (Lines 51 & 53)", () => {
  // Line 51: Demand Forecasting
  it("Line 51: calculates weighted velocity and recommends purchase reorder quantities with size curve", () => {
    // 30 days of sales history: average ~3-4 shirts/day
    const history: SalesHistoryPoint[] = Array.from({ length: 30 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, "0")}`,
      unitsSold: 3 + (i % 3), // 3, 4, 5 units
    }));

    const velocity = calculateWeightedDailyVelocity(history);
    expect(velocity).toBeGreaterThan(2.5);

    const forecast = forecastProductDemand({
      variantId: "v_shirt_cotton",
      sku: "SHIRT-COTTON-SLIM",
      productName: "Men Slim Cotton Shirt",
      salesHistory: history,
      currentStock: 20, // 20 units in store
      pendingPoUnits: 10, // 10 units already ordered
      supplierLeadTimeDays: 7,
      forecastHorizonDays: 30,
      sizeDistribution: { S: 0.1, M: 0.4, L: 0.4, XL: 0.1 },
    });

    expect(forecast.projectedDemandUnits).toBeGreaterThan(60);
    expect(forecast.recommendedSafetyStockUnits).toBeGreaterThan(0);
    expect(forecast.recommendedReorderQty).toBeGreaterThan(40);

    // Size breakdown
    expect(forecast.forecastBySize["M"]).toBeGreaterThan(forecast.forecastBySize["S"]!);
    expect(forecast.forecastBySize["L"]).toBeGreaterThan(forecast.forecastBySize["XL"]!);
  });

  // Line 53: Dynamic Markdown Pricing
  it("Line 53: triggers 35% markdown on stagnant stock while strictly respecting cost price floor", () => {
    const items: InventoryAgingFact[] = [
      {
        variantId: "v_fast",
        sku: "HOT-SUMMER-SHIRT",
        productName: "Hot Summer Shirt",
        inwardDate: "2026-10-01", // 17 days ago
        initialStock: 50,
        currentStock: 15,
        unitsSold: 35, // 70% STR -> Hot seller
        mrpMinor: 150000, // ₹1,500
        currentPriceMinor: 150000,
        costPriceMinor: 70000,
      },
      {
        variantId: "v_stagnant",
        sku: "DEAD-WINTER-PANTS",
        productName: "Old Winter Pants",
        inwardDate: "2026-06-01", // 139 days ago
        initialStock: 40,
        currentStock: 35,
        unitsSold: 5, // 12.5% STR -> Stagnant
        mrpMinor: 200000, // ₹2,000
        currentPriceMinor: 200000,
        costPriceMinor: 90000, // Cost is ₹900
      },
    ];

    const markdowns = evaluateDynamicPricingRules(items, new Date("2026-10-18"), 10);
    expect(markdowns.length).toBe(2);

    // Hot item: zero markdown
    const hotRec = markdowns.find(m => m.sku === "HOT-SUMMER-SHIRT");
    expect(hotRec?.pricingStrategy).toBe("PREMIUM_NO_DISCOUNT");
    expect(hotRec?.recommendedMarkdownPct).toBe(0);
    expect(hotRec?.recommendedNewPriceMinor).toBe(150000);

    // Stagnant item: 35% markdown (₹2,000 -> ₹1,300)
    const deadRec = markdowns.find(m => m.sku === "DEAD-WINTER-PANTS");
    expect(deadRec?.pricingStrategy).toBe("AGGRESSIVE_CLEARANCE");
    expect(deadRec?.recommendedMarkdownPct).toBe(35);
    expect(deadRec?.recommendedNewPriceMinor).toBe(130000); // ₹1,300
    // Gross margin is still healthy above cost (₹1,300 vs ₹900 cost = +30.8%)
    expect(deadRec?.grossMarginPctAtNewPrice).toBeGreaterThan(25);
  });
});
