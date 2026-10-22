/**
 * Broken Size-Run Detection & Clearance Markdown Engine
 * Identifies designs with broken size curves (e.g., M and L sold out, leaving only XS/XXL),
 * and automatically formulates bundling, clearance discounts, or factory reorder triggers.
 */

export interface SizeInventoryStatus {
  size: string;
  inStockQty: number;
  isCoreSize: boolean; // e.g. M, L, XL are core sizes; XS, 3XL are edge sizes
}

export interface DesignSizeRun {
  designNumber: string;
  brand: string;
  category: string;
  sizes: SizeInventoryStatus[];
  originalMrp: number;
}

export interface BrokenRunAlert {
  designNumber: string;
  brand: string;
  isBroken: boolean;
  brokenSeverity: "none" | "moderate" | "severe";
  coreSizesStockout: string[];
  leftoverSizes: { size: string; qty: number }[];
  suggestedAction: "reorder_core_sizes" | "bundle_offer" | "clearance_markdown" | "none";
  suggestedDiscountPercent?: number;
  explanation: string;
}

export function analyzeSizeRun(design: DesignSizeRun): BrokenRunAlert {
  const coreSizes = design.sizes.filter((s) => s.isCoreSize);
  const outOfStockCore = coreSizes.filter((s) => s.inStockQty === 0).map((s) => s.size);
  const leftoverSizes = design.sizes
    .filter((s) => s.inStockQty > 0)
    .map((s) => ({ size: s.size, qty: s.inStockQty }));

  const totalCoreCount = coreSizes.length;
  const stockoutCoreCount = outOfStockCore.length;

  if (stockoutCoreCount === 0) {
    return {
      designNumber: design.designNumber,
      brand: design.brand,
      isBroken: false,
      brokenSeverity: "none",
      coreSizesStockout: [],
      leftoverSizes,
      suggestedAction: "none",
      explanation: "Complete size curve available. Normal selling pace.",
    };
  }

  const isSevere = stockoutCoreCount >= Math.ceil(totalCoreCount * 0.67);
  const totalLeftoverQty = leftoverSizes.reduce((sum, s) => sum + s.qty, 0);

  if (isSevere) {
    return {
      designNumber: design.designNumber,
      brand: design.brand,
      isBroken: true,
      brokenSeverity: "severe",
      coreSizesStockout: outOfStockCore,
      leftoverSizes,
      suggestedAction: totalLeftoverQty > 20 ? "bundle_offer" : "clearance_markdown",
      suggestedDiscountPercent: totalLeftoverQty > 20 ? 30 : 40,
      explanation: `Core sizes (${outOfStockCore.join(", ")}) sold out. Leftover sizes (${leftoverSizes.map((l) => `${l.size}:${l.qty}`).join(", ")}) risk becoming dead stock. Apply 30-40% clearance or BOGO combo.`,
    };
  }

  return {
    designNumber: design.designNumber,
    brand: design.brand,
    isBroken: true,
    brokenSeverity: "moderate",
    coreSizesStockout: outOfStockCore,
    leftoverSizes,
    suggestedAction: "reorder_core_sizes",
    suggestedDiscountPercent: 15,
    explanation: `Size ${outOfStockCore.join(", ")} out of stock while other sizes remain. Reorder core sizes or offer 15% incentive on slow-moving sizes.`,
  };
}
