import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, mockTx, mockWriteAuditLogTx } = vi.hoisted(() => ({
  mockDb: {
    store: { findFirst: vi.fn() },
    company: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  mockTx: {
    store: { findFirst: vi.fn() },
    company: { findUnique: vi.fn(), update: vi.fn() },
    $queryRaw: vi.fn(),
  },
  mockWriteAuditLogTx: vi.fn(),
}));

vi.mock("@/server/db", () => ({ db: mockDb }));
vi.mock("@/server/identity/audit", () => ({ writeAuditLogTx: mockWriteAuditLogTx }));

const { getCompanyCreditDefault, setCompanyCreditDefault } = await import("@/server/khata/companyCreditSettings");

const actor = {
  tenantId: "tenant-a",
  userId: "owner-a",
  tenantRole: "OWNER" as const,
  storeId: "store-a",
};

const company = {
  id: "company-a",
  name: "Company A",
  currency: "INR",
  defaultCreditMode: "BLOCKED" as const,
  defaultCreditLimitMinor: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockTx) => unknown) => callback(mockTx));
  mockTx.store.findFirst.mockResolvedValue({ companyId: company.id });
  mockTx.company.findUnique.mockResolvedValue(company);
  mockTx.$queryRaw.mockResolvedValue([{ id: company.id }]);
  mockTx.company.update.mockImplementation(async ({ data }: { data: { defaultCreditMode: string; defaultCreditLimitMinor: number | null } }) => data);
});

describe("company-scoped credit defaults", () => {
  it("refuses non-owners before touching the database", async () => {
    const result = await setCompanyCreditDefault({
      actor: { ...actor, tenantRole: "STAFF" },
      mode: "UNLIMITED",
      limitMinor: null,
      correlationId: "corr-1",
    });

    expect(result).toEqual({ status: "forbidden" });
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("derives the Company through the tenant-scoped session Store", async () => {
    mockTx.store.findFirst.mockResolvedValue(null);
    const result = await setCompanyCreditDefault({ actor, mode: "BLOCKED", limitMinor: null, correlationId: "corr-2" });

    expect(result).toEqual({ status: "company_unavailable" });
    expect(mockTx.store.findFirst).toHaveBeenCalledWith({
      where: { id: actor.storeId, tenantId: actor.tenantId },
      select: { companyId: true },
    });
    expect(mockTx.company.findUnique).not.toHaveBeenCalled();
    expect(mockTx.company.update).not.toHaveBeenCalled();
  });

  it.each([
    ["BLOCKED", null],
    ["UNLIMITED", null],
    ["LIMITED", 250_000],
  ] as const)("saves valid %s configuration under the Store's tenant Company", async (mode, limitMinor) => {
    mockTx.company.findUnique.mockResolvedValue({
      ...company,
      defaultCreditMode: mode === "BLOCKED" ? "UNLIMITED" : "BLOCKED",
      defaultCreditLimitMinor: null,
    });
    mockTx.company.update.mockResolvedValue({ defaultCreditMode: mode, defaultCreditLimitMinor: limitMinor });
    const result = await setCompanyCreditDefault({ actor, mode, limitMinor, correlationId: "corr-3" });

    expect(result).toMatchObject({ status: "ok", companyId: company.id, mode, limitMinor, changed: true });
    expect(mockTx.company.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id_tenantId: { id: company.id, tenantId: actor.tenantId } },
      data: { defaultCreditMode: mode, defaultCreditLimitMinor: limitMinor },
    }));
    expect(mockWriteAuditLogTx).toHaveBeenCalledWith(mockTx, expect.objectContaining({
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: "CompanyCreditDefaultUpdated",
      correlationId: "corr-3",
      metadata: expect.objectContaining({ companyId: company.id }),
    }));
  });

  it.each([
    ["MISSING", null],
    ["LIMITED", null],
    ["LIMITED", 0],
    ["LIMITED", 2_147_483_648],
    ["UNLIMITED", 500],
  ])("rejects invalid mode/limit pair %s / %s before opening a transaction", async (mode, limitMinor) => {
    const result = await setCompanyCreditDefault({ actor, mode, limitMinor, correlationId: "corr-4" });
    expect(result.status).toBe("validation_error");
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it("locks and updates only the Company resolved from the Store, then audits in that transaction", async () => {
    mockTx.company.update.mockResolvedValue({ defaultCreditMode: "UNLIMITED", defaultCreditLimitMinor: null });
    await setCompanyCreditDefault({ actor, mode: "UNLIMITED", limitMinor: null, correlationId: "corr-5" });

    expect(mockTx.$queryRaw).toHaveBeenCalledOnce();
    expect(mockWriteAuditLogTx.mock.calls[0]?.[0]).toBe(mockTx);
    expect(mockTx.company.update.mock.invocationCallOrder[0]).toBeLessThan(mockWriteAuditLogTx.mock.invocationCallOrder[0]!);
  });

  it("does not write an audit event for an unchanged setting", async () => {
    mockTx.company.findUnique.mockResolvedValue({ ...company, defaultCreditMode: "BLOCKED", defaultCreditLimitMinor: null });
    const result = await setCompanyCreditDefault({ actor, mode: "BLOCKED", limitMinor: null, correlationId: "corr-6" });
    expect(result).toMatchObject({ status: "ok", changed: false });
    expect(mockTx.company.update).not.toHaveBeenCalled();
    expect(mockWriteAuditLogTx).not.toHaveBeenCalled();
  });

  it("reads only the Company attached to the session Store", async () => {
    mockDb.store.findFirst.mockResolvedValue({ companyId: company.id });
    mockDb.company.findUnique.mockResolvedValue(company);
    const result = await getCompanyCreditDefault(actor);

    expect(result).toMatchObject({ status: "ok", companyId: company.id, mode: "BLOCKED" });
    expect(mockDb.store.findFirst).toHaveBeenCalledWith({ where: { id: actor.storeId, tenantId: actor.tenantId }, select: { companyId: true } });
    expect(mockDb.company.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id_tenantId: { id: company.id, tenantId: actor.tenantId } },
    }));
  });
});
