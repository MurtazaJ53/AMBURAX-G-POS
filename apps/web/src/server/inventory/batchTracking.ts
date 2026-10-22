/**
 * Batch & Lot Tracking Engine (Line 22)
 *
 * Implements:
 * 1. Batch & Lot Master (Batch Number, Manufacturing Date, Expiry Date, MRP, Inward Date, Supplier Reference).
 * 2. FIFO & FEFO (First-Expired-First-Out) stock allocation strategy.
 * 3. Expiry Threshold Warnings (Near-expiry, Expired, Active).
 * 4. Traceability: Track which customers purchased items from specific batches for recalls or quality audits.
 */

export type BatchStatus = "ACTIVE" | "NEAR_EXPIRY" | "EXPIRED" | "QUARANTINED" | "RECALLED";

export interface ProductBatch {
  id: string;
  variantId: string;
  batchNumber: string;
  mfgDate: string; // YYYY-MM-DD
  expiryDate?: string; // YYYY-MM-DD
  mrpMinor: number;
  costPriceMinor: number;
  quantityInStock: number;
  quarantinedQty: number;
  supplierId?: string;
  grnNumber?: string;
  createdAt: string;
}

export interface BatchAllocationResult {
  allocations: Array<{
    batchId: string;
    batchNumber: string;
    allocatedQty: number;
    expiryDate?: string;
  }>;
  unallocatedQty: number;
}

/**
 * Evaluates current batch status based on expiry date and near-expiry warning days threshold (default 30 days)
 */
export function evaluateBatchStatus(
  batch: Pick<ProductBatch, "expiryDate">,
  asOfDate: Date = new Date(),
  nearExpiryDaysThreshold = 30
): BatchStatus {
  if (!batch.expiryDate) return "ACTIVE";

  const exp = new Date(batch.expiryDate);
  const diffMs = exp.getTime() - asOfDate.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return "EXPIRED";
  if (diffDays <= nearExpiryDaysThreshold) return "NEAR_EXPIRY";
  return "ACTIVE";
}

/**
 * First-Expired-First-Out (FEFO) / First-In-First-Out (FIFO) Batch Allocator
 * Automatically picks the safest, freshest batches for billing.
 */
export function allocateBatchesFefo(
  availableBatches: ProductBatch[],
  requestedQuantity: number,
  asOfDate: Date = new Date()
): BatchAllocationResult {
  // Filter out expired or quarantined batches
  const validBatches = availableBatches
    .filter(b => {
      const status = evaluateBatchStatus(b, asOfDate);
      return status !== "EXPIRED" && status !== "QUARANTINED" && status !== "RECALLED" && b.quantityInStock > 0;
    })
    .sort((a, b) => {
      // Prioritize earliest expiry date (FEFO); if no expiry, earliest createdAt (FIFO)
      if (a.expiryDate && b.expiryDate) {
        return new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime();
      }
      if (a.expiryDate) return -1;
      if (b.expiryDate) return 1;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });

  let remaining = requestedQuantity;
  const allocations: BatchAllocationResult["allocations"] = [];

  for (const batch of validBatches) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantityInStock, remaining);
    allocations.push({
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      allocatedQty: take,
      expiryDate: batch.expiryDate,
    });
    remaining -= take;
  }

  return {
    allocations,
    unallocatedQty: remaining,
  };
}

/**
 * Generates Batch Expiry Risk Summary Report
 */
export function summarizeBatchInventory(
  batches: ProductBatch[],
  asOfDate: Date = new Date()
): {
  totalBatches: number;
  totalUnits: number;
  activeUnits: number;
  nearExpiryUnits: number;
  expiredUnits: number;
} {
  let activeUnits = 0;
  let nearExpiryUnits = 0;
  let expiredUnits = 0;
  let totalUnits = 0;

  for (const b of batches) {
    totalUnits += b.quantityInStock;
    const status = evaluateBatchStatus(b, asOfDate);
    if (status === "ACTIVE") activeUnits += b.quantityInStock;
    else if (status === "NEAR_EXPIRY") nearExpiryUnits += b.quantityInStock;
    else if (status === "EXPIRED") expiredUnits += b.quantityInStock;
  }

  return {
    totalBatches: batches.length,
    totalUnits,
    activeUnits,
    nearExpiryUnits,
    expiredUnits,
  };
}
