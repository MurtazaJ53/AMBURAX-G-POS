import { describe, expect, it, vi } from "vitest";

const items = ["v1", "v2", "v3"].map((variantId, i) => ({ variantId, quantity: 2, variant: { sku: `SKU-${i}` } }));
const db = {
  heldBill: {
    updateMany: vi.fn(async () => ({ count: 1 })),
    findFirst: vi.fn(async () => ({ id: "hb-1", items })),
  },
  stockLevel: {
    findUnique: vi.fn(async () => ({ quantity: 5 })),
    findMany: vi.fn(async () => [
      { variantId: "v1", quantity: 5 },
      { variantId: "v2", quantity: 1 },
    ]),
  },
};
vi.mock("@/server/db", () => ({ db }));

const { resumeHeldBill } = await import("@/server/sales/heldBillService");

describe("resumeHeldBill stock recheck (bug 42)", () => {
  it("reads every line's stock in one query and still warns on short lines", async () => {
    const result = await resumeHeldBill({ tenantId: "t1", storeId: "s1", id: "hb-1", resumedByUserId: "u1", expectedVersion: 1 });
    expect(db.stockLevel.findUnique).not.toHaveBeenCalled();
    expect(db.stockLevel.findMany).toHaveBeenCalledTimes(1);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.join(" ")).toMatch(/SKU-1 only has 1/);
    expect(result.warnings.join(" ")).toMatch(/SKU-2 only has 0/);
  });
});
