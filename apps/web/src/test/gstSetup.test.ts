import { beforeEach, describe, expect, it, vi } from "vitest";

// turnOnGst's refusals, with Prisma mocked. Turning GST on end to end (products moved to
// "needs a GST type", the ERPNext event) is covered against Postgres in
// src/test-integration/gstSetup.test.ts.

const mockTx = {
  tenant: { findUnique: vi.fn(), update: vi.fn() },
  store: { findMany: vi.fn() },
  productVariant: { updateMany: vi.fn() },
};

const mockDb = {
  $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
};

vi.mock("@/server/db", () => ({ db: mockDb }));
vi.mock("@/server/identity/audit", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/server/events/outbox", () => ({ enqueueOutboxEvent: vi.fn(async () => {}) }));

const { turnOnGst } = await import("@/server/catalog/gstSetup");

const owner = { tenantId: "tenant-1", userId: "user-1", tenantRole: "OWNER" as const };
const GUJARAT_GSTIN = "24ABCDE1234F1Z6";

beforeEach(() => {
  vi.clearAllMocks();
  mockTx.tenant.findUnique.mockResolvedValue({ taxId: null });
  mockTx.productVariant.updateMany.mockResolvedValue({ count: 0 });
});

describe("turning GST on", () => {
  it("is allowed when every store is in the GSTIN's state", async () => {
    mockTx.store.findMany.mockResolvedValue([
      { name: "Main", state: "Gujarat" },
      { name: "Surat Ring Road", state: "GJ" },
    ]);
    expect(await turnOnGst({ actor: owner, gstin: GUJARAT_GSTIN, scheme: "REGULAR" })).toEqual({ status: "ok", needsReview: 0 });
    expect(mockTx.tenant.update).toHaveBeenCalledTimes(1);
  });

  it("is refused, naming the stores, when a store is outside the GSTIN's state, and changes nothing", async () => {
    mockTx.store.findMany.mockResolvedValue([
      { name: "Main", state: "Gujarat" },
      { name: "Pune FC Road", state: "Maharashtra" },
    ]);
    expect(await turnOnGst({ actor: owner, gstin: GUJARAT_GSTIN })).toEqual({
      status: "invalid",
      reason:
        "Your GSTIN is registered in Gujarat, but Pune FC Road (Maharashtra) is in another state. Every store in a GST-registered business must be in Gujarat; a store in another state needs its own GST registration and a separate business.",
    });
    expect(mockTx.tenant.update).not.toHaveBeenCalled();
    expect(mockTx.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it("refuses the composition scheme before looking at anything", async () => {
    expect(await turnOnGst({ actor: owner, gstin: GUJARAT_GSTIN, scheme: "COMPOSITION" })).toEqual({
      status: "invalid",
      reason: "Composition scheme isn't supported yet: composition dealers must issue a Bill of Supply and pay tax differently. Contact support.",
    });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });
});
