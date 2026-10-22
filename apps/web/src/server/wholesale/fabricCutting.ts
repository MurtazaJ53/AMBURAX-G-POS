/**
 * Fabric Raw Material Stock & Cutting / Production Orders (Line 75)
 *
 * Implements:
 * 1. Raw Material Fabric Master (Fabric Type, Weave, Color, Thaan/Roll ID, Width in Inches, Length in Meters, Cost per Meter).
 * 2. Cutting Order Planner (Marker Ratio, Lay Count, Consumption per Piece, Fabric Wastage Allowance).
 * 3. Multi-Size Cutting Breakup (Generates cut bundles for S, M, L, XL, XXL from fabric rolls).
 * 4. Raw Material Consumption Voucher (Deducts meters from inventory, increases Semi-Finished cut bundles).
 */

export interface FabricRollStock {
  id: string;
  rollNumber: string;
  fabricType: string; // e.g. "Cotton Poplin 60s"
  color: string;
  widthInches: number; // e.g. 58 inches
  initialMeters: number;
  availableMeters: number;
  costPerMeterMinor: number; // In paise
  supplierName?: string;
}

export interface SizeCuttingRatio {
  size: string;
  ratioCount: number; // e.g. S:1, M:2, L:2, XL:1
}

export interface CuttingOrderPlan {
  id: string;
  cuttingOrderNumber: string; // e.g. "CUT-2026-012"
  styleName: string;
  fabricRollId: string;
  fabricRollNumber: string;
  fabricConsumedMeters: number;
  averageConsumptionPerPieceMeters: number; // e.g. 1.85 meters per shirt
  layersCut: number; // Number of plies in fabric lay
  sizeRatios: SizeCuttingRatio[];
  totalExpectedPieces: number;
  cutBundles: Array<{
    size: string;
    piecesProduced: number;
    bundleBarcode: string;
  }>;
  wastagePercentage: number;
  status: "PLANNED" | "CUTTING_COMPLETED";
}

/**
 * Plans a fabric cutting order with lay layers and ratio breakdown
 */
export function planCuttingOrder(params: {
  styleName: string;
  fabricRoll: FabricRollStock;
  averageConsumptionPerPieceMeters: number;
  layersCut: number;
  sizeRatios: SizeCuttingRatio[];
  wastageTolerancePct?: number;
}): CuttingOrderPlan {
  const ratioSum = params.sizeRatios.reduce((acc, r) => acc + r.ratioCount, 0);
  const totalExpectedPieces = ratioSum * params.layersCut;
  const theoreticalFabricMeters = totalExpectedPieces * params.averageConsumptionPerPieceMeters;

  const wastagePct = params.wastageTolerancePct ?? 3.5; // Standard 3.5% cutting wastage
  const actualFabricConsumed = Number((theoreticalFabricMeters * (1 + wastagePct / 100)).toFixed(2));

  if (actualFabricConsumed > params.fabricRoll.availableMeters) {
    throw new Error(
      `Insufficient fabric on roll ${params.fabricRoll.rollNumber}. Required: ${actualFabricConsumed}m, Available: ${params.fabricRoll.availableMeters}m`
    );
  }

  const orderNum = `CUT-${Date.now().toString().slice(-6)}`;

  const cutBundles = params.sizeRatios.map(r => {
    const pieces = r.ratioCount * params.layersCut;
    return {
      size: r.size,
      piecesProduced: pieces,
      bundleBarcode: `BND-${orderNum}-${r.size}`,
    };
  });

  return {
    id: `cut_${Date.now()}`,
    cuttingOrderNumber: orderNum,
    styleName: params.styleName,
    fabricRollId: params.fabricRoll.id,
    fabricRollNumber: params.fabricRoll.rollNumber,
    fabricConsumedMeters: actualFabricConsumed,
    averageConsumptionPerPieceMeters: params.averageConsumptionPerPieceMeters,
    layersCut: params.layersCut,
    sizeRatios: params.sizeRatios,
    totalExpectedPieces,
    cutBundles,
    wastagePercentage: wastagePct,
    status: "PLANNED",
  };
}

/**
 * Executes cutting order: deducts fabric from roll and marks cutting completed
 */
export function executeCuttingOrder(
  plan: CuttingOrderPlan,
  fabricRoll: FabricRollStock
): {
  updatedRoll: FabricRollStock;
  completedPlan: CuttingOrderPlan;
} {
  const updatedMeters = Number((fabricRoll.availableMeters - plan.fabricConsumedMeters).toFixed(2));

  return {
    updatedRoll: {
      ...fabricRoll,
      availableMeters: Math.max(0, updatedMeters),
    },
    completedPlan: {
      ...plan,
      status: "CUTTING_COMPLETED",
    },
  };
}
