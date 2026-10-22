/**
 * Store-Level Size-Curve Optimization Engine (Line 54)
 *
 * Implements:
 * 1. Historical size sales distribution curves per store & per apparel category.
 *    (e.g., Surat Store sells: S=10%, M=30%, L=40%, XL=15%, XXL=5% vs Mumbai Store sells: S=25%, M=45%, L=20%, XL=10%).
 * 2. Size Skew Detection: Flags under-stocked fast-moving sizes (runouts/lost sales) vs over-stocked slow sizes (dead capital).
 * 3. Optimal Pre-pack / Purchase Ratio Recommendation: Given total purchase quantity (e.g., 100 units), calculates optimal units per size.
 */

export interface SizeSalesData {
  size: string; // e.g. "S", "M", "L", "XL", "XXL" or "30", "32", "34", "36", "38"
  unitsSold: number;
  stockoutDays: number;
  currentStock: number;
}

export interface OptimizedSizeCurve {
  storeId: string;
  category: string;
  totalHistoricalUnits: number;
  ratios: Record<string, number>; // Size -> normalized percentage (0.0 to 1.0)
  imbalances: Array<{
    size: string;
    historicalSharePct: number;
    currentStockSharePct: number;
    status: "UNDERSTOCKED_RISK" | "BALANCED" | "OVERSTOCKED_RISK";
  }>;
}

export function computeStoreSizeCurve(params: {
  storeId: string;
  category: string;
  historicalSales: SizeSalesData[];
}): OptimizedSizeCurve {
  let totalUnitsSold = 0;
  let totalCurrentStock = 0;

  for (const s of params.historicalSales) {
    totalUnitsSold += s.unitsSold;
    totalCurrentStock += s.currentStock;
  }

  const ratios: Record<string, number> = {};
  const imbalances: OptimizedSizeCurve["imbalances"] = [];

  for (const s of params.historicalSales) {
    const historicalShare = totalUnitsSold > 0 ? s.unitsSold / totalUnitsSold : 0;
    ratios[s.size] = Number(historicalShare.toFixed(3));

    const currentShare = totalCurrentStock > 0 ? s.currentStock / totalCurrentStock : 0;
    const shareDiff = currentShare - historicalShare;

    let status: "UNDERSTOCKED_RISK" | "BALANCED" | "OVERSTOCKED_RISK" = "BALANCED";
    if (shareDiff < -0.10) {
      status = "UNDERSTOCKED_RISK";
    } else if (shareDiff > 0.15) {
      status = "OVERSTOCKED_RISK";
    }

    imbalances.push({
      size: s.size,
      historicalSharePct: Math.round(historicalShare * 100),
      currentStockSharePct: Math.round(currentShare * 100),
      status,
    });
  }

  return {
    storeId: params.storeId,
    category: params.category,
    totalHistoricalUnits: totalUnitsSold,
    ratios,
    imbalances,
  };
}

/**
 * Recommends purchase order allocation across sizes based on the store's size curve
 */
export function recommendSizePackAllocation(
  sizeCurve: OptimizedSizeCurve,
  totalBatchUnitsToOrder: number
): Record<string, number> {
  const allocation: Record<string, number> = {};
  let allocatedSoFar = 0;

  const entries = Object.entries(sizeCurve.ratios);
  for (let i = 0; i < entries.length; i++) {
    const [size, ratio] = entries[i]!;
    if (i === entries.length - 1) {
      // Allocate remainder to avoid rounding drift
      allocation[size] = Math.max(0, totalBatchUnitsToOrder - allocatedSoFar);
    } else {
      const units = Math.round(totalBatchUnitsToOrder * ratio);
      allocation[size] = units;
      allocatedSoFar += units;
    }
  }

  return allocation;
}
