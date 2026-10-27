import { beforeEach, describe, expect, it, vi } from "vitest";

// processExchange with Prisma, the stock ledger and createSale mocked: a repeated request with the
// same idempotency key must return the first exchange, not make a second one.

const originalSale = {
  id: "sale-1",
  tenantId: "tenant-1",
  storeId: "store-1",
  status: "COMPLETED",
  customerId: null,
  items: [{ id: "item-1", variantId: "v-1", quantity: 2, lineTotalMinor: 200_000, nameSnapshot: "Shirt" }],
  returns: [],
};

const mockTx = {
  saleReturn: { create: vi.fn() },
};
const mockDb = {
  sale: { findUnique: vi.fn(), findFirst: vi.fn() },
  saleReturn: { findUnique: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
};

vi.mock("@/server/db", () => ({ db: mockDb }));
vi.mock("@/server/identity/audit", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/server/events/outbox", () => ({ enqueueOutboxEvent: vi.fn(async () => {}) }));
vi.mock("@/server/inventory/stockLedger", () => ({ applyStockMovement: vi.fn(async () => {}) }));
vi.mock("@/server/sales/saleService", () => ({ createSale: vi.fn() }));

const { processExchange } = await import("@/server/sales/exchangeService");
const { createSale } = await import("@/server/sales/saleService");

const input = {
  tenantId: "tenant-1",
  storeId: "store-1",
  originalSaleId: "sale-1",
  actor: { userId: "user-1", tenantRole: "OWNER" as const, membershipRole: null },
  returnItems: [{ originalSaleItemId: "item-1", quantity: 1 }],
  newLines: [{ variantId: "v-2", quantity: 1 }],
  settlement: { method: "CASH" as const },
  reason: "size swap",
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.sale.findUnique.mockResolvedValue(originalSale);
  mockDb.saleReturn.findUnique.mockResolvedValue(null);
  mockTx.saleReturn.create.mockResolvedValue({ id: "ret-1", totalRefundMinor: 100_000 });
  vi.mocked(createSale).mockResolvedValue({ status: "ok", sale: { id: "sale-2", totalMinor: 120_000 } } as never);
});

describe("exchange idempotency", () => {
  it("names the exchange after the request's key, so a retry can find it", async () => {
    const first = await processExchange(input);
    expect(first.exchangeId).toBe(`EXC-${input.idempotencyKey}`);
    expect(mockTx.saleReturn.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ idempotencyKey: `EXC-${input.idempotencyKey}` }) }),
    );
  });

  it("writes the replacement sale in the exchange's own transaction, so a failure after the return undoes both", async () => {
    vi.mocked(createSale).mockResolvedValueOnce({ status: "validation_error", reason: "Out of stock." } as never);
    await expect(processExchange(input)).rejects.toMatchObject({ code: "SALE_CREATION_FAILED" });
    // The return was written first, inside the transaction...
    expect(mockTx.saleReturn.create).toHaveBeenCalledTimes(1);
    // ...and the sale was attempted in that same transaction, which the error then rolls back.
    expect(createSale).toHaveBeenCalledWith(expect.objectContaining({ tx: mockTx }));
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
  });

  it("returns the first exchange for a repeated key and creates nothing new", async () => {
    mockDb.saleReturn.findUnique.mockResolvedValue({ id: "ret-1", totalRefundMinor: 100_000, amburaxExchangeId: `EXC-${input.idempotencyKey}` });
    mockDb.sale.findFirst.mockResolvedValue({ id: "sale-2", totalMinor: 120_000 });

    const again = await processExchange(input);

    expect(mockTx.saleReturn.create).not.toHaveBeenCalled();
    expect(createSale).not.toHaveBeenCalled();
    expect(again).toMatchObject({
      exchangeId: `EXC-${input.idempotencyKey}`,
      saleReturn: { id: "ret-1" },
      newSale: { id: "sale-2" },
      returnCreditMinor: 100_000,
      newSaleTotalMinor: 120_000,
      netDifferenceMinor: 20_000,
      replayed: true,
    });
  });
});
