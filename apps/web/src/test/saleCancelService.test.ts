import { beforeEach, describe, expect, it, vi } from "vitest";

// cancelSale's rules, with Prisma, the stock ledger, the approval PIN and the outbox mocked.

const mockTx = {
  sale: { update: vi.fn() },
  salePayment: { updateMany: vi.fn() },
};
const mockDb = {
  sale: { findUnique: vi.fn() },
  user: { findUnique: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
};

vi.mock("@/server/db", () => ({ db: mockDb }));
vi.mock("@/server/identity/audit", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/server/events/outbox", () => ({ enqueueOutboxEvent: vi.fn(async () => {}) }));
vi.mock("@/server/inventory/stockLedger", () => ({ applyStockMovement: vi.fn(async () => {}), movementKey: {} }));
vi.mock("@/server/identity/approvalPin", () => ({ verifyApprovalPin: vi.fn(), listApprovers: vi.fn() }));

const { cancelSale } = await import("@/server/sales/saleCancelService");
const { applyStockMovement } = await import("@/server/inventory/stockLedger");
const { verifyApprovalPin } = await import("@/server/identity/approvalPin");

const owner = { userId: "u-owner", tenantRole: "OWNER" as const, membershipRole: null };
const cashier = { userId: "u-cashier", tenantRole: "STAFF" as const, membershipRole: "CASHIER" };
const base = { tenantId: "t-1", storeId: "s-1", saleId: "sale-1", reason: "wrong item" };

function sale(overrides: Record<string, unknown> = {}) {
  return {
    id: "sale-1",
    tenantId: "t-1",
    storeId: "s-1",
    status: "COMPLETED",
    completedAt: new Date(),
    items: [
      { id: "i-1", variantId: "v-1", quantity: 2 },
      { id: "i-2", variantId: "v-2", quantity: 1 },
    ],
    payments: [],
    returns: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.sale.findUnique.mockResolvedValue(sale());
  mockTx.sale.update.mockResolvedValue({ id: "sale-1", status: "VOIDED" });
  mockTx.salePayment.updateMany.mockResolvedValue({ count: 1 });
});

describe("cancelling a bill", () => {
  it("lets the owner void today's bill, voids its payments and puts every line back in stock once", async () => {
    await cancelSale({ ...base, actor: owner });
    expect(mockTx.sale.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "VOIDED" } }));
    expect(mockTx.salePayment.updateMany).toHaveBeenCalledWith({ where: { saleId: "sale-1" }, data: { status: "FAILED" } });
    expect(applyStockMovement).toHaveBeenCalledTimes(2);
    expect(applyStockMovement).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({ variantId: "v-1", quantityDelta: 2, type: "RETURN", idempotencyKey: "SALE_VOID:sale-1:i-1" }),
    );
  });

  it("refuses another business's bill and another store's bill", async () => {
    mockDb.sale.findUnique.mockResolvedValueOnce(sale({ tenantId: "t-other" }));
    await expect(cancelSale({ ...base, actor: owner })).rejects.toMatchObject({ code: "FORBIDDEN" });
    mockDb.sale.findUnique.mockResolvedValueOnce(sale({ storeId: "s-other" }));
    await expect(cancelSale({ ...base, actor: owner })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a bill that is already void, not completed, or has returns", async () => {
    mockDb.sale.findUnique.mockResolvedValueOnce(sale({ status: "VOIDED" }));
    await expect(cancelSale({ ...base, actor: owner })).rejects.toMatchObject({ code: "ALREADY_VOIDED" });
    mockDb.sale.findUnique.mockResolvedValueOnce(sale({ status: "PENDING" }));
    await expect(cancelSale({ ...base, actor: owner })).rejects.toMatchObject({ code: "INVALID_STATUS" });
    mockDb.sale.findUnique.mockResolvedValueOnce(sale({ returns: [{ id: "r-1" }] }));
    await expect(cancelSale({ ...base, actor: owner })).rejects.toMatchObject({ code: "HAS_RETURNS" });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("makes a cashier get a manager's PIN, and refuses a wrong one", async () => {
    await expect(cancelSale({ ...base, actor: cashier })).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    vi.mocked(verifyApprovalPin).mockResolvedValueOnce({ status: "invalid" } as never);
    await expect(cancelSale({ ...base, actor: cashier, approval: { approverUserId: "u-mgr", pin: "0000" } })).rejects.toMatchObject({
      code: "INVALID_PIN",
    });
    expect(mockDb.$transaction).not.toHaveBeenCalled();

    vi.mocked(verifyApprovalPin).mockResolvedValueOnce({ status: "ok" } as never);
    mockDb.user.findUnique.mockResolvedValueOnce({ name: "Meena" });
    await cancelSale({ ...base, actor: cashier, approval: { approverUserId: "u-mgr", pin: "1234" } });
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
  });

  it("needs a manager's PIN even for the owner when the bill is from an earlier day", async () => {
    mockDb.sale.findUnique.mockResolvedValueOnce(sale({ completedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) }));
    await expect(cancelSale({ ...base, actor: owner })).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
  });
});
