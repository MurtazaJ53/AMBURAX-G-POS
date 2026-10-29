import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ErpRequest, ErpResponse, ErpTransport } from "@/server/erp/transport";
import { ErpError } from "@/server/erp/errors";
import type { ErpCredentialProvider } from "@/server/erp/config";

const mockTx = {
  tenant: { update: vi.fn() },
  outboxEvent: { updateMany: vi.fn() },
  auditLog: { create: vi.fn() },
};

const mockDb = {
  tenant: { findUnique: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
};

vi.mock("@/server/db", () => ({ db: mockDb }));
vi.mock("@/server/identity/audit", () => ({
  writeAuditLogTx: vi.fn(async (tx, params) => {
    await tx.auditLog.create({ data: params });
  }),
}));

const mockCredentials: ErpCredentialProvider = {
  async credentialsFor() {
    return { baseUrl: "http://erp.local", apiKey: "key", apiSecret: "secret" };
  },
};

const { configureTenantErpSite } = await import("@/server/tenant/tenantSiteConfigService");

describe("tenantSiteConfigService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.tenant.findUnique.mockResolvedValue({ id: "t-1" });
    mockTx.tenant.update.mockResolvedValue({});
    mockTx.outboxEvent.updateMany.mockResolvedValue({ count: 3 });
    mockTx.auditLog.create.mockResolvedValue({});
  });

  it("refuses to configure site if preflight ping fails and leaves tenant paused", async () => {
    const failingTransport: ErpTransport = {
      async send(req: ErpRequest): Promise<ErpResponse> {
        throw new ErpError({
          kind: "unavailable",
          message: "Connection refused on port 8080",
        });
      },
    };

    const result = await configureTenantErpSite(
      "t-1",
      "frontend",
      { userId: "admin-1" },
      failingTransport,
      mockCredentials as never
    );

    expect(result.status).toBe("site_unreachable");
    expect(result.error).toContain("Connection refused on port 8080");
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(mockTx.tenant.update).not.toHaveBeenCalled();
    expect(mockTx.outboxEvent.updateMany).not.toHaveBeenCalled();
  });

  it("sets site, unpauses and re-queues in one transaction when ping succeeds", async () => {
    const successTransport: ErpTransport = {
      async send(req: ErpRequest): Promise<ErpResponse> {
        return { status: 200, body: { message: "pong" } };
      },
    };

    const result = await configureTenantErpSite(
      "t-1",
      "scratch.local",
      { userId: "admin-1" },
      successTransport,
      mockCredentials as never,
      "corr-test"
    );

    expect(result.status).toBe("ok");
    expect(result.redrivenCount).toBe(3);

    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);

    expect(mockTx.tenant.update).toHaveBeenCalledWith({
      where: { id: "t-1" },
      data: {
        erpnextSiteId: "scratch.local",
        isSyncPaused: false,
        syncPausedReason: null,
      },
    });

    expect(mockTx.outboxEvent.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: "t-1",
        publishedAt: null,
        deadLetteredAt: { not: null },
        failureCode: "ERP_SITE_NOT_SET",
      },
      data: {
        deadLetteredAt: null,
        attempts: 0,
        nextAttemptAt: expect.any(Date),
        failureCode: null,
        lastError: null,
      },
    });
  });

  it("re-queues only ERP_SITE_NOT_SET events and writes audit count", async () => {
    const successTransport: ErpTransport = {
      async send(): Promise<ErpResponse> {
        return { status: 200, body: { message: "pong" } };
      },
    };

    mockTx.outboxEvent.updateMany.mockResolvedValueOnce({ count: 5 });

    const result = await configureTenantErpSite(
      "t-1",
      "scratch.local",
      { userId: "admin-user" },
      successTransport,
      mockCredentials as never,
      "corr-audit"
    );

    expect(result.status).toBe("ok");
    expect(result.redrivenCount).toBe(5);

    // Verify filter explicitly targeted failureCode: "ERP_SITE_NOT_SET"
    const updateCall = mockTx.outboxEvent.updateMany.mock.calls[0][0];
    expect(updateCall.where.failureCode).toBe("ERP_SITE_NOT_SET");

    // Verify audit log
    expect(mockTx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "t-1",
        userId: "admin-user",
        action: "TenantErpSiteConfiguredAndOutboxRedriven",
        metadata: expect.objectContaining({
          siteId: "scratch.local",
          redrivenCount: 5,
        }),
      }),
    });
  });
});
