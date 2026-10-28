import { describe, expect, it, vi } from "vitest";

const db = {
  lead: { findFirst: vi.fn(async () => ({ id: "lead-1", tenantId: "t-a", phone: null })) },
  // Store "s-b" belongs to another tenant: only an unscoped lookup would find it.
  store: {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === "s-b" ? { id: "s-b", tenantId: "t-b" } : null)),
    findFirst: vi.fn(async ({ where }: { where: { id?: string; tenantId?: string } }) =>
      where.id === "s-b" && (where.tenantId === undefined || where.tenantId === "t-b") ? { id: "s-b", tenantId: "t-b" } : null,
    ),
  },
  uom: { findFirst: vi.fn(async () => ({ id: "uom-1" })) },
  productVariant: { findFirst: vi.fn(async () => null) },
  $transaction: vi.fn(async () => {
    throw new Error("must not reach the transaction with another tenant's store");
  }),
};
vi.mock("@/server/db", () => ({ db }));

const { convertLeadToOrder } = await import("@/server/b2b/leads");

describe("convertLeadToOrder (bug 39)", () => {
  it("refuses a store id that belongs to another tenant", async () => {
    const result = await convertLeadToOrder({ tenantId: "t-a", actorUserId: "u-a", leadId: "lead-1", storeId: "s-b" });
    expect(result.status).toBe("error");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
