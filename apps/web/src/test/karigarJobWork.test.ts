import { describe, it, expect } from "vitest";
import {
  createJobWorkOrder,
  receiveStitchedGoodsFromKarigar,
  calculateKarigarWastageRate,
  type KarigarProfile,
} from "@/server/wholesale/karigarJobWork";

describe("Karigar Job Work & Wage Tracking Engine (Line 74)", () => {
  const masterTailor: KarigarProfile = {
    id: "karigar_salim",
    name: "Master Salim Tailor",
    phone: "9825987654",
    specialty: "STITCHING",
    pieceRateMinor: 18000, // ₹180 per piece
    advanceBalanceMinor: 500000, // ₹5,000 existing cash advance
  };

  it("issues fabric work order and sets target quantities", () => {
    const jw = createJobWorkOrder({
      karigar: masterTailor,
      productTarget: "Cotton Casual Shirts",
      dueAt: "2026-10-25T18:00:00Z",
      fabricItems: [
        {
          fabricName: "100% Linen Sky Blue",
          color: "Sky Blue",
          metersIssued: 50,
          expectedPieces: 25, // 2 meters per shirt
        },
        {
          fabricName: "100% Linen Olive Green",
          color: "Olive Green",
          metersIssued: 50,
          expectedPieces: 25,
        },
      ],
    });

    expect(jw.jobWorkNumber.startsWith("JW-")).toBe(true);
    expect(jw.expectedPiecesTotal).toBe(50);
    expect(jw.status).toBe("ISSUED");
    expect(jw.pieceRateMinor).toBe(18000);
  });

  it("calculates piece-rate wages and advance deduction upon receiving stitched goods", () => {
    const jw = createJobWorkOrder({
      karigar: masterTailor,
      productTarget: "Cotton Casual Shirts",
      dueAt: "2026-10-25T18:00:00Z",
      fabricItems: [
        {
          fabricName: "Linen",
          color: "Blue",
          metersIssued: 100,
          expectedPieces: 50,
        },
      ],
    });

    // Received 48 good pieces, 1 defective piece. Deduct ₹2,000 from existing advance
    const completed = receiveStitchedGoodsFromKarigar(jw, {
      goodPieces: 48,
      rejectedPieces: 1,
      advanceDeductionMinor: 200000, // ₹2,000 advance adjustment
    });

    // Total wage: 48 pieces * ₹180 = ₹8,640 (864,000 paise)
    expect(completed.totalWagesMinor).toBe(864000);
    expect(completed.advanceDeductedMinor).toBe(200000);
    // Net payable: ₹8,640 - ₹2,000 = ₹6,640 (664,000 paise)
    expect(completed.netPayableWagesMinor).toBe(664000);
    expect(completed.status).toBe("RECEIVED_COMPLETED");
  });

  it("audits fabric wastage and defect rates accurately", () => {
    const jw = createJobWorkOrder({
      karigar: masterTailor,
      productTarget: "Cotton Casual Shirts",
      dueAt: "2026-10-25T18:00:00Z",
      fabricItems: [
        {
          fabricName: "Linen",
          color: "Blue",
          metersIssued: 100,
          expectedPieces: 50,
        },
      ],
    });

    const completed = receiveStitchedGoodsFromKarigar(jw, {
      goodPieces: 47,
      rejectedPieces: 2,
    });

    const audit = calculateKarigarWastageRate(completed);
    expect(audit.expectedPieces).toBe(50);
    expect(audit.actualPieces).toBe(49);
    expect(audit.shortagePieces).toBe(1); // 1 piece missing/short
    // Defect rate: 2 / 49 = 4.1%
    expect(audit.defectRatePct).toBe(4.1);
  });
});
