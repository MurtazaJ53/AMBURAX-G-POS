// "Same day" for cancelling a bill is the shop's day in India, whatever time zone the server runs in.
process.env.TZ = "UTC";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockTx = { sale: { update: vi.fn() }, salePayment: { updateMany: vi.fn() } };
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

const owner = { userId: "u-owner", tenantRole: "OWNER" as const, membershipRole: null };
const input = { tenantId: "t-1", storeId: "s-1", saleId: "sale-1", reason: "wrong item", actor: owner };

function saleAt(completedAt: string) {
  return { id: "sale-1", tenantId: "t-1", storeId: "s-1", status: "COMPLETED", completedAt: new Date(completedAt), items: [], payments: [], returns: [] };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // 2026-10-27 04:00 UTC = 09:30 IST on 27 October
  vi.setSystemTime(new Date("2026-10-27T04:00:00.000Z"));
  mockTx.sale.update.mockResolvedValue({ id: "sale-1", status: "VOIDED" });
  mockTx.salePayment.updateMany.mockResolvedValue({ count: 0 });
});
afterEach(() => vi.useRealTimers());

describe("cancelling a bill on the same India day", () => {
  it("lets the owner void a bill rung up at 00:30 IST today without a PIN", async () => {
    mockDb.sale.findUnique.mockResolvedValue(saleAt("2026-10-26T19:00:00.000Z")); // 27 Oct 00:30 IST
    await expect(cancelSale(input)).resolves.toBeDefined();
  });

  it("still asks for a PIN for a bill from 23:30 IST yesterday", async () => {
    mockDb.sale.findUnique.mockResolvedValue(saleAt("2026-10-26T18:00:00.000Z")); // 26 Oct 23:30 IST
    await expect(cancelSale(input)).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
  });
});
