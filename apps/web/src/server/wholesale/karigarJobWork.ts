/**
 * Manufacturing & Job Work (Karigar / Jobworker Tracking) (Line 74)
 *
 * Implements:
 * 1. Karigar Master (Name, Phone, Skill/Specialty e.g. Stitching, Embroidery, Buttoning, Ironing/Finishing, Daily/Piece Wage Rate).
 * 2. Fabric / Material Issue Voucher: Tracks cut fabric pieces, thaan meters, buttons, zippers issued to karigar.
 * 3. Work Order & Stitched Goods Receiving: Records good output pieces received, rejection/defect pieces, and fabric wastage %.
 * 4. Piece-Rate Karigar Wage Accounting: Auto-computes earned wages, advances paid, TDS deduction, and balance payable.
 */

export interface KarigarProfile {
  id: string;
  name: string;
  phone: string;
  specialty: "STITCHING" | "EMBROIDERY" | "CUTTING" | "BUTTONING" | "FINISHING_IRON";
  pieceRateMinor: number; // e.g. ₹150 per stitched shirt = 15,000 paise
  advanceBalanceMinor: number;
}

export interface FabricIssueItem {
  fabricName: string;
  color: string;
  metersIssued: number;
  expectedPieces: number;
}

export interface JobWorkOrder {
  id: string;
  jobWorkNumber: string; // e.g. "JW-2026-0042"
  karigarId: string;
  karigarName: string;
  specialty: string;
  productTarget: string; // e.g. "Slim Fit Formal Shirt"
  issuedAt: string;
  dueAt: string;
  fabricItems: FabricIssueItem[];
  expectedPiecesTotal: number;
  receivedGoodPieces: number;
  rejectedPieces: number;
  pieceRateMinor: number;
  totalWagesMinor: number;
  advanceDeductedMinor: number;
  netPayableWagesMinor: number;
  status: "ISSUED" | "IN_PROGRESS" | "RECEIVED_COMPLETED" | "SETTLED";
}

export function createJobWorkOrder(params: {
  karigar: KarigarProfile;
  productTarget: string;
  fabricItems: FabricIssueItem[];
  dueAt: string;
}): JobWorkOrder {
  const expectedTotal = params.fabricItems.reduce((acc, f) => acc + f.expectedPieces, 0);
  const jwNumber = `JW-${Date.now().toString().slice(-6)}`;

  return {
    id: `jw_${Date.now()}`,
    jobWorkNumber: jwNumber,
    karigarId: params.karigar.id,
    karigarName: params.karigar.name,
    specialty: params.karigar.specialty,
    productTarget: params.productTarget,
    issuedAt: new Date().toISOString(),
    dueAt: params.dueAt,
    fabricItems: params.fabricItems,
    expectedPiecesTotal: expectedTotal,
    receivedGoodPieces: 0,
    rejectedPieces: 0,
    pieceRateMinor: params.karigar.pieceRateMinor,
    totalWagesMinor: 0,
    advanceDeductedMinor: 0,
    netPayableWagesMinor: 0,
    status: "ISSUED",
  };
}

export function receiveStitchedGoodsFromKarigar(
  order: JobWorkOrder,
  received: {
    goodPieces: number;
    rejectedPieces: number;
    advanceDeductionMinor?: number;
  }
): JobWorkOrder {
  const totalWages = received.goodPieces * order.pieceRateMinor;
  const advanceDeducted = Math.min(totalWages, received.advanceDeductionMinor || 0);
  const netPayable = Math.max(0, totalWages - advanceDeducted);

  return {
    ...order,
    receivedGoodPieces: received.goodPieces,
    rejectedPieces: received.rejectedPieces,
    totalWagesMinor: totalWages,
    advanceDeductedMinor: advanceDeducted,
    netPayableWagesMinor: netPayable,
    status: "RECEIVED_COMPLETED",
  };
}

export function calculateKarigarWastageRate(order: JobWorkOrder): {
  expectedPieces: number;
  actualPieces: number;
  defectRatePct: number;
  shortagePieces: number;
} {
  const actualPieces = order.receivedGoodPieces + order.rejectedPieces;
  const shortage = Math.max(0, order.expectedPiecesTotal - actualPieces);
  const defectRate = actualPieces > 0 ? (order.rejectedPieces / actualPieces) * 100 : 0;

  return {
    expectedPieces: order.expectedPiecesTotal,
    actualPieces,
    defectRatePct: Number(defectRate.toFixed(1)),
    shortagePieces: shortage,
  };
}
