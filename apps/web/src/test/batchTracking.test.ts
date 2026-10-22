import { describe, it, expect } from "vitest";
import {
  evaluateBatchStatus,
  allocateBatchesFefo,
  summarizeBatchInventory,
  type ProductBatch,
} from "@/server/inventory/batchTracking";

describe("Batch and Lot Tracking Engine (Line 22)", () => {
  const baseDate = new Date("2026-10-18T00:00:00Z");

  const sampleBatches: ProductBatch[] = [
    {
      id: "b1",
      variantId: "v_perfume_1",
      batchNumber: "LOT-2026-A",
      mfgDate: "2026-01-01",
      expiryDate: "2026-10-25", // 7 days remaining -> NEAR_EXPIRY
      mrpMinor: 99900,
      costPriceMinor: 50000,
      quantityInStock: 10,
      quarantinedQty: 0,
      createdAt: "2026-01-05T00:00:00Z",
    },
    {
      id: "b2",
      variantId: "v_perfume_1",
      batchNumber: "LOT-2026-B",
      mfgDate: "2026-03-01",
      expiryDate: "2027-03-01", // Long expiry -> ACTIVE
      mrpMinor: 99900,
      costPriceMinor: 50000,
      quantityInStock: 25,
      quarantinedQty: 0,
      createdAt: "2026-03-05T00:00:00Z",
    },
    {
      id: "b3",
      variantId: "v_perfume_1",
      batchNumber: "LOT-2025-OLD",
      mfgDate: "2025-01-01",
      expiryDate: "2026-09-01", // Past date -> EXPIRED
      mrpMinor: 89900,
      costPriceMinor: 45000,
      quantityInStock: 5,
      quarantinedQty: 0,
      createdAt: "2025-01-05T00:00:00Z",
    },
  ];

  it("classifies batch status based on expiry thresholds", () => {
    expect(evaluateBatchStatus(sampleBatches[0]!, baseDate)).toBe("NEAR_EXPIRY");
    expect(evaluateBatchStatus(sampleBatches[1]!, baseDate)).toBe("ACTIVE");
    expect(evaluateBatchStatus(sampleBatches[2]!, baseDate)).toBe("EXPIRED");
  });

  it("allocates stock using FEFO (First-Expired-First-Out) avoiding expired lots", () => {
    // Requesting 15 units.
    // LOT-2026-A has 10 units (expires 2026-10-25).
    // LOT-2026-B has 25 units (expires 2027-03-01).
    // LOT-2025-OLD is expired so it MUST be skipped.
    const result = allocateBatchesFefo(sampleBatches, 15, baseDate);

    expect(result.unallocatedQty).toBe(0);
    expect(result.allocations.length).toBe(2);

    expect(result.allocations[0]?.batchNumber).toBe("LOT-2026-A");
    expect(result.allocations[0]?.allocatedQty).toBe(10); // Takes all 10 near expiry units first

    expect(result.allocations[1]?.batchNumber).toBe("LOT-2026-B");
    expect(result.allocations[1]?.allocatedQty).toBe(5);  // Takes remaining 5 from fresher batch
  });

  it("summarizes batch inventory breakdown accurately", () => {
    const summary = summarizeBatchInventory(sampleBatches, baseDate);
    expect(summary.totalBatches).toBe(3);
    expect(summary.totalUnits).toBe(40);
    expect(summary.nearExpiryUnits).toBe(10);
    expect(summary.activeUnits).toBe(25);
    expect(summary.expiredUnits).toBe(5);
  });
});
