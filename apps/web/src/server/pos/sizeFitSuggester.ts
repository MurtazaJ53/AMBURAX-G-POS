/**
 * Customer Size & Fit Prediction Engine
 * Recommends garment sizes based on customer's historical brand purchases,
 * returns/exchanges history, and brand-specific fit profiling (e.g., slim fit vs regular fit).
 */

export interface HistoricalPurchaseItem {
  brand: string;
  category: string; // e.g. "Formal Shirt", "Kurti", "Jeans"
  size: string; // "38", "40", "M", "L", "XL", "32"
  fitType?: "slim" | "regular" | "relaxed" | "oversized";
  returnedOrExchanged?: boolean;
  returnReason?: string;
  purchaseDate: string;
}

export interface SizeFitRecommendation {
  brand: string;
  category: string;
  recommendedSize: string;
  confidenceScore: number; // 0 - 100
  reasoning: string;
  fitAdvice?: string;
}

export function recommendSizeForCustomer(
  customerId: string,
  targetBrand: string,
  targetCategory: string,
  history: HistoricalPurchaseItem[]
): SizeFitRecommendation | null {
  if (!history || history.length === 0) return null;

  // Filter for exact brand and category matches first
  const brandCategoryMatches = history.filter(
    (h) =>
      h.brand.toLowerCase() === targetBrand.toLowerCase() &&
      h.category.toLowerCase() === targetCategory.toLowerCase() &&
      !h.returnedOrExchanged
  );

  if (brandCategoryMatches.length > 0) {
    const sizeCounts: Record<string, number> = {};
    for (const item of brandCategoryMatches) {
      sizeCounts[item.size] = (sizeCounts[item.size] || 0) + 1;
    }
    const sortedSizes = Object.entries(sizeCounts).sort((a, b) => b[1] - a[1]);
    const topEntry = sortedSizes[0];
    if (!topEntry) return null;
    const [topSize, topCount] = topEntry;

    const confidence = Math.min(95, 60 + topCount * 10);
    return {
      brand: targetBrand,
      category: targetCategory,
      recommendedSize: topSize,
      confidenceScore: confidence,
      reasoning: `Customer bought size ${topSize} in ${targetBrand} ${targetCategory} ${topCount} time(s) without return.`,
      fitAdvice: `Standard fit in ${targetBrand}. Recommend size ${topSize}.`,
    };
  }

  // Cross-brand category match (e.g. bought size 40 in Peter England, now buying Raymond)
  const categoryMatches = history.filter(
    (h) =>
      h.category.toLowerCase() === targetCategory.toLowerCase() &&
      !h.returnedOrExchanged
  );

  if (categoryMatches.length > 0) {
    const sizeCounts: Record<string, number> = {};
    for (const item of categoryMatches) {
      sizeCounts[item.size] = (sizeCounts[item.size] || 0) + 1;
    }
    const sortedSizes = Object.entries(sizeCounts).sort((a, b) => b[1] - a[1]);
    const topEntry = sortedSizes[0];
    if (!topEntry) return null;
    const [topSize] = topEntry;

    return {
      brand: targetBrand,
      category: targetCategory,
      recommendedSize: topSize,
      confidenceScore: 70,
      reasoning: `Customer usually takes size ${topSize} across other ${targetCategory} brands.`,
      fitAdvice: `Check shoulder/chest measurement if moving between slim and regular brands.`,
    };
  }

  return null;
}
