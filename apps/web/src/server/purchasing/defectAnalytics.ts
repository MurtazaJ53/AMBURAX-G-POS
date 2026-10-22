/**
 * Defect Analytics & Supplier Quality Control Engine
 * Analyzes customer returns and exchanges by defect reason, fabric fault,
 * supplier/mill, and design number to flag defective batches and support debit notes.
 */

export interface DefectReturnRecord {
  id: string;
  invoiceId: string;
  sku: string;
  designNumber: string;
  brand: string;
  supplierId: string;
  supplierName: string;
  defectReason:
    | "fabric_tear"
    | "color_bleeding"
    | "stitching_defect"
    | "size_shrinkage"
    | "zipper_button_damage"
    | "weaving_slub";
  costPrice: number;
  returnDate: string;
  lotOrBatchNumber?: string;
}

export interface SupplierDefectSummary {
  supplierId: string;
  supplierName: string;
  totalDefectiveItems: number;
  totalDefectCost: number;
  topDefectReasons: { reason: string; count: number }[];
  highRiskDesigns: string[];
  recommendedDebitNoteAmount: number;
}

export function analyzeSupplierDefects(
  records: DefectReturnRecord[]
): SupplierDefectSummary[] {
  const supplierMap = new Map<
    string,
    {
      supplierId: string;
      supplierName: string;
      items: DefectReturnRecord[];
    }
  >();

  for (const r of records) {
    let s = supplierMap.get(r.supplierId);
    if (!s) {
      s = { supplierId: r.supplierId, supplierName: r.supplierName, items: [] };
      supplierMap.set(r.supplierId, s);
    }
    s.items.push(r);
  }

  const summaries: SupplierDefectSummary[] = [];

  for (const s of supplierMap.values()) {
    const totalDefectCost = s.items.reduce((sum, it) => sum + it.costPrice, 0);

    // Reason frequency
    const reasonCounts: Record<string, number> = {};
    const designCounts: Record<string, number> = {};

    for (const it of s.items) {
      reasonCounts[it.defectReason] = (reasonCounts[it.defectReason] || 0) + 1;
      designCounts[it.designNumber] = (designCounts[it.designNumber] || 0) + 1;
    }

    const topDefectReasons = Object.entries(reasonCounts)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

    // Designs with 3 or more defects are considered high-risk batches
    const highRiskDesigns = Object.entries(designCounts)
      .filter(([_, count]) => count >= 3)
      .map(([design]) => design);

    summaries.push({
      supplierId: s.supplierId,
      supplierName: s.supplierName,
      totalDefectiveItems: s.items.length,
      totalDefectCost: Math.round(totalDefectCost * 100) / 100,
      topDefectReasons,
      highRiskDesigns,
      recommendedDebitNoteAmount: Math.round(totalDefectCost * 100) / 100,
    });
  }

  return summaries.sort((a, b) => b.totalDefectCost - a.totalDefectCost);
}
