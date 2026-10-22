import { describe, expect, it, vi, beforeEach } from "vitest";

// Mocks for all persistence, ledger, event outbox, and authorization boundaries.
// Guaranteed: no live database, Docker container, or ERPNext instance is contacted.

const mockTx = {
  $queryRaw: vi.fn(),
  store: {
    update: vi.fn(),
  },
  sale: {
    create: vi.fn(),
  },
  saleItem: {
    createMany: vi.fn(),
  },
  customer: {
    update: vi.fn(),
  },
};

const mockDb = {
  sale: {
    findUnique: vi.fn(),
  },
  store: {
    findFirst: vi.fn(),
  },
  user: {
    findFirst: vi.fn(),
  },
  storeMembership: {
    findUnique: vi.fn(),
  },
  productVariant: {
    findMany: vi.fn(),
  },
  customer: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
};

vi.mock("@/server/db", () => ({ db: mockDb }));
vi.mock("@/server/identity/audit", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/server/events/outbox", () => ({ enqueueOutboxEvent: vi.fn(async () => ({} as any)) }));
vi.mock("@/server/inventory/stockLedger", () => ({
  applyStockMovement: vi.fn(async () => {}),
  movementKey: { sale: (saleId: string, variantId: string) => `sale:${saleId}:${variantId}` },
}));
vi.mock("@/server/capability/capabilityService", () => ({
  requireCapability: vi.fn(async () => ({ status: "ok" })),
}));
vi.mock("@/server/pos/posSessionService", () => ({
  resolveSessionForSale: vi.fn(async () => ({ status: "ok", session: { id: "pos-sess-1" } })),
}));

const { createSale } = await import("@/server/sales/saleService");
const { updateCustomer } = await import("@/server/sales/customers");

const TENANT_ID = "tenant-khata-1";
const STORE_ID = "store-1";
const CASHIER_ID = "user-cashier-1";

describe("Khata Foundation & Fail-Closed Credit Policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockDb.sale.findUnique.mockResolvedValue(null);
    mockDb.store.findFirst.mockResolvedValue({ id: STORE_ID });
    mockDb.user.findFirst.mockResolvedValue({ tenantRole: "STAFF" });
    mockDb.storeMembership.findUnique.mockResolvedValue({ role: "CASHIER" });
    mockDb.productVariant.findMany.mockResolvedValue([
      {
        id: "variant-1",
        sku: "SKU-1",
        priceMinor: 10000,
        taxRateBp: 500,
        taxTreatment: "TAXABLE",
        isActive: true,
        product: { name: "Test Item" },
      },
    ]);
  });

  it("refuses udhar at a store with no legal Company and writes nothing (Q5)", async () => {
    const res = await createSale({
      tenantId: TENANT_ID,
      storeId: STORE_ID,
      cashierUserId: CASHIER_ID,
      idempotencyKey: "idem-khata-failclosed-1",
      lines: [{ variantId: "variant-1", quantity: 1 }],
      customerId: "cust-1",
      onAccountMinor: 5000,
      payment: { method: "CASH", amountMinor: 5000 },
      correlationId: "corr-1",
    });

    expect(res.status).toBe("credit_facility_unavailable");
    if (res.status === "credit_facility_unavailable") {
      expect(res.reason).toContain("isn't linked to a company");
    }

    // Verify zero database mutations took place
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(mockTx.sale.create).not.toHaveBeenCalled();
    expect(mockTx.store.update).not.toHaveBeenCalled();
  });

  it("clears phoneVerifiedAt when customer phone number is changed", async () => {
    mockDb.customer.findUnique
      .mockResolvedValueOnce({
        id: "cust-1",
        name: "Ravi Kumar",
        phone: "+919876500001",
        email: "ravi@example.com",
      })
      .mockResolvedValueOnce(null); // No phone conflict

    mockTx.customer.update.mockResolvedValue({
      id: "cust-1",
      name: "Ravi Kumar",
      phone: "+919876500002",
    });

    const res = await updateCustomer({
      tenantId: TENANT_ID,
      id: "cust-1",
      phone: "+919876500002",
    });

    expect(res.status).toBe("ok");
    expect(mockTx.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id_tenantId: { id: "cust-1", tenantId: TENANT_ID } },
        data: expect.objectContaining({
          phone: "+919876500002",
          phoneVerifiedAt: null,
        }),
      })
    );
  });
});
