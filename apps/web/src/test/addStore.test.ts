import { beforeEach, describe, expect, it, vi } from "vitest";

// addStore's GSTIN-state rule, with Prisma mocked. The full write path (company, membership,
// outbox, audit) is covered against Postgres in src/test-integration/addStore.test.ts.

const mockTx = {
  store: { create: vi.fn() },
  storeMembership: { create: vi.fn() },
};

const mockDb = {
  tenant: { findUnique: vi.fn() },
  company: { findFirst: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
};

vi.mock("@/server/db", () => ({ db: mockDb }));
vi.mock("@/server/identity/audit", () => ({ writeAuditLogTx: vi.fn(async () => {}) }));
vi.mock("@/server/events/outbox", () => ({ enqueueOutboxEvent: vi.fn(async () => {}) }));

const { addStore } = await import("@/server/tenant/addStore");

const owner = { tenantId: "tenant-1", userId: "user-1", tenantRole: "OWNER" as const };
const surat = { actor: owner, name: "Surat Ring Road", code: "SURAT2", addressLine: "Ring Road", city: "Surat", state: "Gujarat" };
const pune = { ...surat, name: "Pune FC Road", code: "PUNE1", addressLine: "FC Road", city: "Pune", state: "Maharashtra" };

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.company.findFirst.mockResolvedValue({ id: "company-1", currency: "INR" });
  mockTx.store.create.mockResolvedValue({ id: "store-2" });
  mockTx.storeMembership.create.mockResolvedValue({});
});

describe("adding a store to a GST-registered business", () => {
  it("refuses a store outside the GSTIN's state with a clear message, and creates nothing", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({ taxId: "24ABCDE1234F1Z6" });
    const res = await addStore(pune);
    expect(res).toEqual({
      status: "validation_error",
      field: "state",
      reason:
        "Your GSTIN is registered in Gujarat, so every store in this business must be in Gujarat. A store in another state needs its own GST registration and a separate business.",
    });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("allows a store in the GSTIN's state", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({ taxId: "24ABCDE1234F1Z6" });
    expect(await addStore(surat)).toEqual({ status: "ok", storeId: "store-2" });
  });

  it("leaves a business without a GSTIN free to open stores in any state", async () => {
    mockDb.tenant.findUnique.mockResolvedValue({ taxId: null });
    expect(await addStore(pune)).toEqual({ status: "ok", storeId: "store-2" });
  });
});
