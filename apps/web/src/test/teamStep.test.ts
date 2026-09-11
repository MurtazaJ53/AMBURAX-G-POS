import { describe, expect, it, vi, beforeEach } from "vitest";

const mockDb = {
  tenant: { updateMany: vi.fn() },
};

vi.mock("@/server/db", () => ({ db: mockDb }));
vi.mock("@/server/identity/loginGuard", () => ({ isIpRateLimited: vi.fn(async () => false) }));
vi.mock("@/server/identity/audit", () => ({ writeAuditLog: vi.fn(async () => {}) }));
vi.mock("@/server/identity/session", () => ({ resolveSession: vi.fn() }));

const { completeTeamStep } = await import("@/server/tenant/teamStep");
const { resolveSession } = await import("@/server/identity/session");

function ownerSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "session-1",
    userId: "owner-1",
    tenantId: "tenant-1",
    user: { id: "owner-1", email: "owner@sharma-traders.example", tenantRole: "OWNER" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveSession).mockResolvedValue(ownerSession() as never);
  mockDb.tenant.updateMany.mockResolvedValue({ count: 1 });
});

describe("completeTeamStep", () => {
  it("returns unauthorized without touching the tenant", async () => {
    vi.mocked(resolveSession).mockResolvedValueOnce(null);
    const result = await completeTeamStep({ sessionToken: "t", ip: "1.2.3.4", correlationId: "c1" });
    expect(result.status).toBe("unauthorized");
    expect(mockDb.tenant.updateMany).not.toHaveBeenCalled();
  });

  it("returns forbidden for a STAFF user", async () => {
    vi.mocked(resolveSession).mockResolvedValueOnce(
      ownerSession({ user: { id: "staff-1", email: "staff@example.com", tenantRole: "STAFF" } }) as never,
    );
    const result = await completeTeamStep({ sessionToken: "t", ip: "1.2.3.4", correlationId: "c1" });
    expect(result.status).toBe("forbidden");
  });

  it("completes the step with zero invitations sent — Skip is a fully supported path", async () => {
    const result = await completeTeamStep({ sessionToken: "t", ip: "1.2.3.4", correlationId: "c1" });
    expect(result.status).toBe("ok");
    expect(mockDb.tenant.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "tenant-1", onboardingStep: "STORE_CREATED" } }),
    );
  });

  it("is safe against two concurrent completions — only one can win the claim", async () => {
    mockDb.tenant.updateMany.mockResolvedValueOnce({ count: 0 });
    const result = await completeTeamStep({ sessionToken: "t", ip: "1.2.3.4", correlationId: "c1" });
    expect(result.status).toBe("already_completed");
  });
});
