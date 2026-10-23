import { describe, expect, it, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// registerBusiness touches Prisma (including a P2002 unique-violation path for both the
// slug and the idempotency-key races), the login-attempt guard, onboarding-session
// creation, and audit logging. All mocked — this proves the *code's* handling of a lost
// creation race, not Postgres's actual constraint/isolation behavior under real load
// (no live database in this sandbox — see README's known-gaps note, same as A4).

function uniqueViolation(field: string) {
  return new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on the fields: (\`${field}\`)`, {
    code: "P2002",
    clientVersion: "5.22.0",
    meta: { target: [field] },
  });
}

const mockTx = {
  tenant: { create: vi.fn() },
  onboardingSession: { create: vi.fn() },
  // Registration seeds the new tenant's default capabilities inside the same transaction, so
  // the mocked client has to offer the delegate the real one does.
  tenantCapability: { createMany: vi.fn() },
  attributeDefinition: { upsert: vi.fn(async () => ({ id: "def-1" })) },
  attributeValue: { upsert: vi.fn(async () => ({ id: "val-1" })) },
  sizeGroup: { upsert: vi.fn(async () => ({ id: "grp-1" })) },
  sizeGroupItem: { upsert: vi.fn(async () => ({ id: "item-1" })) },
};

const mockDb = {
  tenant: {
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
  },
  $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
};

vi.mock("@/server/db", () => ({ db: mockDb }));
vi.mock("@/server/identity/loginGuard", () => ({
  isIpRateLimited: vi.fn(async () => false),
  recordAttempt: vi.fn(async () => {}),
}));
vi.mock("@/server/identity/audit", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/server/tenant/onboardingSession", () => ({
  createOnboardingSession: vi.fn(async ({ tenantId }: { tenantId: string }) => ({
    token: `token-for-${tenantId}`,
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
  })),
}));

const { registerBusiness } = await import("@/server/tenant/registrationService");
const { isIpRateLimited } = await import("@/server/identity/loginGuard");
const { createOnboardingSession } = await import("@/server/tenant/onboardingSession");

function baseInput(overrides: Partial<Parameters<typeof registerBusiness>[0]> = {}) {
  return {
    businessName: "Sharma Traders",
    businessType: "RETAIL" as const,
    country: "India",
    contactEmail: "owner@sharma-traders.example",
    contactPhone: "+91 90000 00000",
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
    ip: "1.2.3.4",
    userAgent: null,
    correlationId: "c1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.$transaction.mockImplementation(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx));
  mockDb.tenant.findUnique.mockResolvedValue(null);
  mockTx.tenant.create.mockResolvedValue({ id: "tenant-1", name: "Sharma Traders" });
  mockTx.onboardingSession.create.mockResolvedValue({});
  mockTx.tenantCapability.createMany.mockResolvedValue({ count: 1 });
});

describe("registerBusiness", () => {
  it("returns rate_limited without touching the database when the IP limiter trips", async () => {
    vi.mocked(isIpRateLimited).mockResolvedValueOnce(true);
    const result = await registerBusiness(baseInput());
    expect(result.status).toBe("rate_limited");
    expect(mockDb.tenant.findUnique).not.toHaveBeenCalled();
  });

  it("replays an existing tenant for a repeated idempotency key instead of creating a new one", async () => {
    mockDb.tenant.findUnique.mockResolvedValueOnce({ id: "tenant-existing", name: "Sharma Traders" });
    const result = await registerBusiness(baseInput());
    expect(result.status).toBe("ok");
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(createOnboardingSession).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-existing" }),
    );
  });

  it("creates exactly one tenant and one onboarding session on a clean registration", async () => {
    const result = await registerBusiness(baseInput());
    expect(result.status).toBe("ok");
    expect(mockTx.tenant.create).toHaveBeenCalledTimes(1);
    expect(mockTx.onboardingSession.create).toHaveBeenCalledTimes(1);
  });

  /**
   * A new tenant must be able to sell the moment onboarding finishes, so RETAIL is granted with
   * the tenant row itself — in the same transaction, which is what stops a crash between two
   * statements from producing a tenant whose POS is switched off.
   */
  it("grants the new tenant its default capabilities inside the same transaction", async () => {
    const result = await registerBusiness(baseInput());
    expect(result.status).toBe("ok");
    expect(mockTx.tenantCapability.createMany).toHaveBeenCalledTimes(1);
    expect(mockTx.tenantCapability.createMany).toHaveBeenCalledWith({
      data: [{ tenantId: "tenant-1", capability: "RETAIL", enabled: true, id: expect.any(String) }],
      skipDuplicates: true,
    });
  });

  /**
   * Not derived from businessType. A wholesaler who also runs a counter still gets RETAIL,
   * because RETAIL describes what actually works today, not what was ticked at signup.
   */
  it("grants RETAIL even to a tenant that registered as a wholesaler", async () => {
    await registerBusiness(baseInput({ businessType: "WHOLESALE" }));
    expect(mockTx.tenantCapability.createMany).toHaveBeenCalledWith({
      data: [{ tenantId: "tenant-1", capability: "RETAIL", enabled: true, id: expect.any(String) }],
      skipDuplicates: true,
    });
  });

  it("retries with a fresh slug on a slug collision instead of failing the whole request", async () => {
    mockDb.$transaction
      .mockImplementationOnce(async () => {
        throw uniqueViolation("slug");
      })
      .mockImplementationOnce(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx));

    const result = await registerBusiness(baseInput());
    expect(result.status).toBe("ok");
    expect(mockDb.$transaction).toHaveBeenCalledTimes(2);
  });

  it("the creation race fix: falls back to the winner's tenant on a registrationKey collision", async () => {
    mockDb.$transaction.mockImplementationOnce(async () => {
      throw uniqueViolation("registrationKey");
    });
    mockDb.tenant.findUniqueOrThrow.mockResolvedValueOnce({ id: "tenant-winner", name: "Sharma Traders" });

    const result = await registerBusiness(baseInput());
    expect(result.status).toBe("ok");
    // Only the racing request's own create attempt happened — no second tenant was made.
    expect(mockTx.tenant.create).not.toHaveBeenCalled();
    expect(createOnboardingSession).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-winner" }),
    );
  });

  describe("GSTIN validation at sign-up", () => {
    it("accepts registration without taxId (non-GST shop)", async () => {
      const result = await registerBusiness(baseInput({ taxId: undefined }));
      expect(result.status).toBe("ok");
    });

    it("accepts registration with empty or whitespace taxId (non-GST shop)", async () => {
      const result = await registerBusiness(baseInput({ taxId: "   " }));
      expect(result.status).toBe("ok");
    });

    it("accepts registration with valid GSTIN", async () => {
      const result = await registerBusiness(baseInput({ taxId: "24ABCDE1234F1Z6" }));
      expect(result.status).toBe("ok");
    });

    it("rejects registration with invalid GSTIN format", async () => {
      const result = await registerBusiness(baseInput({ taxId: "INVALID_GSTIN" }));
      expect(result.status).toBe("validation_error");
      if (result.status === "validation_error") {
        expect(result.reason).toContain("15 characters");
      }
      expect(mockTx.tenant.create).not.toHaveBeenCalled();
    });

    it("rejects registration with invalid GSTIN checksum", async () => {
      const result = await registerBusiness(baseInput({ taxId: "29AABCU9603R1Z9" }));
      expect(result.status).toBe("validation_error");
      if (result.status === "validation_error") {
        expect(result.reason).toContain("last character doesn't match");
      }
      expect(mockTx.tenant.create).not.toHaveBeenCalled();
    });
  });
});
