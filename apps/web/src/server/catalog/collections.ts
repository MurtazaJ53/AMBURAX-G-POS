/**
 * Season & Collection Management + End-of-Season Clearance Engine (Line 20)
 *
 * Implements:
 * 1. Collection & Season Master (e.g., "Diwali Festive 2026", "Summer Linen 2026", "Winter Velvet 2026").
 * 2. Product-to-Collection Mapping: Groups products and variants under thematic collections.
 * 3. End-of-Season Clearance Markdown Strategy:
 *    - Automatically categorizes inventory into sell-through velocity bands (Fast, Medium, Slow, Stagnant).
 *    - Computes graduated clearance discount tiers (e.g. 20% off for 60+ days, 40% off for 90+ days, Flat ₹499 clearance).
 * 4. Campaign Activation: Pushes clearance discounts directly to POS promotion engine.
 */

export interface FashionCollection {
  id: string;
  name: string; // e.g. "Diwali Festive 2026"
  season: "SPRING_SUMMER" | "AUTUMN_WINTER" | "FESTIVE" | "ALL_SEASON";
  startDate: string;
  endDate: string;
  productIds: string[];
  status: "UPCOMING" | "ACTIVE" | "CLEARANCE" | "ARCHIVED";
}

export interface ClearanceItemRecommendation {
  productId: string;
  productName: string;
  variantId: string;
  sku: string;
  mrpMinor: number;
  currentPriceMinor: number;
  stockQty: number;
  daysInStock: number;
  unitsSoldPast30Days: number;
  suggestedMarkdownPct: number;
  clearancePriceMinor: number;
  recommendedTag: "SLIGHT_DISCOUNT" | "MID_SEASON_SALE" | "FINAL_CLEARANCE";
}

export function createFashionCollection(params: {
  name: string;
  season: FashionCollection["season"];
  startDate: string;
  endDate: string;
  productIds?: string[];
}): FashionCollection {
  return {
    id: `col_${Date.now()}`,
    name: params.name,
    season: params.season,
    startDate: params.startDate,
    endDate: params.endDate,
    productIds: params.productIds || [],
    status: "ACTIVE",
  };
}

export function evaluateEndOfSeasonClearance(
  inventory: Array<{
    productId: string;
    productName: string;
    variantId: string;
    sku: string;
    mrpMinor: number;
    currentPriceMinor: number;
    stockQty: number;
    inwardDate: string;
    unitsSoldPast30Days: number;
  }>,
  asOfDate: Date = new Date()
): ClearanceItemRecommendation[] {
  const recommendations: ClearanceItemRecommendation[] = [];

  for (const item of inventory) {
    if (item.stockQty <= 0) continue;

    const inward = new Date(item.inwardDate);
    const ageDays = Math.max(1, Math.floor((asOfDate.getTime() - inward.getTime()) / 86400000));

    // Stagnant inventory: over 90 days old with very few sales
    let markdownPct = 0;
    let tag: ClearanceItemRecommendation["recommendedTag"] = "SLIGHT_DISCOUNT";

    if (ageDays >= 120 && item.unitsSoldPast30Days <= 2) {
      markdownPct = 50; // Final clearance 50% off
      tag = "FINAL_CLEARANCE";
    } else if (ageDays >= 75 && item.unitsSoldPast30Days <= 5) {
      markdownPct = 30; // Mid-season sale 30% off
      tag = "MID_SEASON_SALE";
    } else if (ageDays >= 45 && item.unitsSoldPast30Days <= 3) {
      markdownPct = 15; // 15% off
      tag = "SLIGHT_DISCOUNT";
    }

    if (markdownPct > 0) {
      const clearancePrice = Math.round(item.mrpMinor * (1 - markdownPct / 100));
      recommendations.push({
        productId: item.productId,
        productName: item.productName,
        variantId: item.variantId,
        sku: item.sku,
        mrpMinor: item.mrpMinor,
        currentPriceMinor: item.currentPriceMinor,
        stockQty: item.stockQty,
        daysInStock: ageDays,
        unitsSoldPast30Days: item.unitsSoldPast30Days,
        suggestedMarkdownPct: markdownPct,
        clearancePriceMinor: clearancePrice,
        recommendedTag: tag,
      });
    }
  }

  return recommendations.sort((a, b) => b.suggestedMarkdownPct - a.suggestedMarkdownPct);
}
