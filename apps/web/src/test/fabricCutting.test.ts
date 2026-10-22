import { describe, it, expect } from "vitest";
import {
  planCuttingOrder,
  executeCuttingOrder,
  type FabricRollStock,
} from "@/server/wholesale/fabricCutting";

describe("Fabric Raw Material Stock & Cutting Order Engine (Line 75)", () => {
  const sampleRoll: FabricRollStock = {
    id: "roll_linen_01",
    rollNumber: "ROLL-LINEN-101",
    fabricType: "Pure Linen 60s",
    color: "White",
    widthInches: 58,
    initialMeters: 500,
    availableMeters: 500,
    costPerMeterMinor: 35000, // ₹350 per meter
  };

  it("plans a multi-size cutting lay and calculates fabric consumption with wastage", () => {
    // Marker ratio: S=1, M=2, L=2, XL=1 (Sum = 6 pieces per lay).
    // Layers: 20 plies.
    // Total pieces = 6 * 20 = 120 shirts.
    // Consumption: 1.80m per shirt. Theoretical = 120 * 1.80 = 216m.
    // With 3.5% wastage = 216 * 1.035 = 223.56m.
    const plan = planCuttingOrder({
      styleName: "Linen Formal White Shirt",
      fabricRoll: sampleRoll,
      averageConsumptionPerPieceMeters: 1.8,
      layersCut: 20,
      sizeRatios: [
        { size: "S", ratioCount: 1 },
        { size: "M", ratioCount: 2 },
        { size: "L", ratioCount: 2 },
        { size: "XL", ratioCount: 1 },
      ],
      wastageTolerancePct: 3.5,
    });

    expect(plan.totalExpectedPieces).toBe(120);
    expect(plan.fabricConsumedMeters).toBe(223.56);
    expect(plan.cutBundles.length).toBe(4);

    const sBundle = plan.cutBundles.find(b => b.size === "S");
    expect(sBundle?.piecesProduced).toBe(20);

    const mBundle = plan.cutBundles.find(b => b.size === "M");
    expect(mBundle?.piecesProduced).toBe(40);
  });

  it("executes cutting order and updates roll inventory balance", () => {
    const plan = planCuttingOrder({
      styleName: "Linen Formal White Shirt",
      fabricRoll: sampleRoll,
      averageConsumptionPerPieceMeters: 1.8,
      layersCut: 20,
      sizeRatios: [
        { size: "S", ratioCount: 1 },
        { size: "M", ratioCount: 2 },
        { size: "L", ratioCount: 2 },
        { size: "XL", ratioCount: 1 },
      ],
    });

    const result = executeCuttingOrder(plan, sampleRoll);
    // 500m - 223.56m = 276.44m remaining on roll
    expect(result.updatedRoll.availableMeters).toBe(276.44);
    expect(result.completedPlan.status).toBe("CUTTING_COMPLETED");
  });

  it("throws error when fabric roll does not have sufficient meters", () => {
    const smallRoll: FabricRollStock = {
      ...sampleRoll,
      availableMeters: 50, // Only 50 meters
    };

    expect(() =>
      planCuttingOrder({
        styleName: "Linen Shirt",
        fabricRoll: smallRoll,
        averageConsumptionPerPieceMeters: 1.8,
        layersCut: 50, // Demands hundreds of meters
        sizeRatios: [{ size: "M", ratioCount: 1 }],
      })
    ).toThrow(/Insufficient fabric on roll/);
  });
});
