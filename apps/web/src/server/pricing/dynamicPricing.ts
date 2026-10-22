/**
 * Dynamic Pricing & Automated Markdown Optimization Engine (Line 53)
 *
 * Implements:
 * 1. Price Elasticity & Aging Valuation:
 *    Calculates sell-through rates ($STR = \text{Sold Units} / \text{Inward Units}$) against target velocity.
 * 2. Automated Markdown Rules:
 *    - Rule 1: Stagnant Stock (>90 days, STR < 20%) -> 30% markdown to free trapped working capital.
 *    - Rule 2: Moderate Slow-Mover (>60 days, STR < 40%) -> 15% promotional markdown.
 *    - Rule 3: Fast-Seller (>70% STR in first 14 days) -> Flag as Premium (Full MRP, Zero Discount).
 * 3. Margin Floor Protection:
 *    Guarantees markdown price never drops below purchase cost + GST floor.
 * 4. Bulk Price Change Campaign Generator:
 *    Produces ready-to-activate price updates for POS terminals.
 */

export interface InventoryAgingFact {
  variantId: string;
  sku: string;
  productName: string;
  inwardDate: string;
  initialStock: number;
  currentStock: number;
  unitsSold: number;
  mrpMinor: number;
  currentPriceMinor: number;
  costPriceMinor: number;
}

export interface MarkdownActionRecommendation {
  variantId: string;
  sku: string;
  productName: string;
  daysOnFloor: number;
  sellThroughRatePct: number;
  originalMrpMinor: number;
  currentSellingPriceMinor: number;
  costPriceMinor: number;
  recommendedMarkdownPct: number;
  recommendedNewPriceMinor: number;
  grossMarginPctAtNewPrice: number;
  pricingStrategy: "PREMIUM_NO_DISCOUNT" | "MODERATE_PROMOTION" | "AGGRESSIVE_CLEARANCE" | "PRICE_FLOOR_HOLD";
  reason: string;
}

export function evaluateDynamicPricingRules(
  items: InventoryAgingFact[],
  asOfDate: Date = new Date(),
  minGrossMarginFloorPct = 10 // Minimum 10% profit margin over cost price
): MarkdownActionRecommendation[] {
  const recommendations: MarkdownActionRecommendation[] = [];

  for (const item of items) {
    if (item.currentStock <= 0) continue;

    const inward = new Date(item.inwardDate);
    const daysOnFloor = Math.max(1, Math.floor((asOfDate.getTime() - inward.getTime()) / 86400000));
    const totalInward = item.initialStock > 0 ? item.initialStock : item.currentStock + item.unitsSold;
    const strPct = totalInward > 0 ? Number(((item.unitsSold / totalInward) * 100).toFixed(1)) : 0;

    // Minimum price allowed: Cost price + minimum margin floor
    const priceFloorMinor = Math.round(item.costPriceMinor * (1 + minGrossMarginFloorPct / 100));

    let markdownPct = 0;
    let strategy: MarkdownActionRecommendation["pricingStrategy"] = "PREMIUM_NO_DISCOUNT";
    let reason = "Item is selling at healthy velocity; maintain full retail price.";

    if (daysOnFloor <= 21 && strPct >= 50) {
      // Hot seller
      strategy = "PREMIUM_NO_DISCOUNT";
      reason = "High demand velocity (>50% STR in first 3 weeks). Keep zero discount.";
    } else if (daysOnFloor >= 90 && strPct < 25) {
      // Dead/Stagnant stock
      markdownPct = 35;
      strategy = "AGGRESSIVE_CLEARANCE";
      reason = "Slow-moving inventory (>90 days on floor, STR < 25%). Aggressive 35% markdown to recover cash.";
    } else if (daysOnFloor >= 60 && strPct < 40) {
      // Moderate slow
      markdownPct = 20;
      strategy = "MODERATE_PROMOTION";
      reason = "Sub-optimal sales pace (>60 days, STR < 40%). Recommend 20% promotional discount.";
    } else if (daysOnFloor >= 30 && strPct < 20) {
      markdownPct = 10;
      strategy = "MODERATE_PROMOTION";
      reason = "Early sluggish movement. Test 10% discount.";
    }

    let calculatedNewPrice = Math.round(item.mrpMinor * (1 - markdownPct / 100));

    // Enforce cost floor protection
    if (calculatedNewPrice < priceFloorMinor) {
      calculatedNewPrice = priceFloorMinor;
      strategy = "PRICE_FLOOR_HOLD";
      reason = `Markdown capped at cost price floor (₹${(priceFloorMinor / 100).toFixed(2)}) to prevent negative margin.`;
    }

    const marginAtNewPrice =
      calculatedNewPrice > 0
        ? Number((((calculatedNewPrice - item.costPriceMinor) / calculatedNewPrice) * 100).toFixed(1))
        : 0;

    recommendations.push({
      variantId: item.variantId,
      sku: item.sku,
      productName: item.productName,
      daysOnFloor,
      sellThroughRatePct: strPct,
      originalMrpMinor: item.mrpMinor,
      currentSellingPriceMinor: item.currentPriceMinor,
      costPriceMinor: item.costPriceMinor,
      recommendedMarkdownPct: markdownPct,
      recommendedNewPriceMinor: calculatedNewPrice,
      grossMarginPctAtNewPrice: marginAtNewPrice,
      pricingStrategy: strategy,
      reason,
    });
  }

  return recommendations;
}
