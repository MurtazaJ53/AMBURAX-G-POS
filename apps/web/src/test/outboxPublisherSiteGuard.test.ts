import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublishableEvent } from "@/server/events/publisher";
import { ErpError } from "@/server/erp/errors";

const mockDb = {
  tenant: {
    findUnique: vi.fn(),
  },
};

vi.mock("@/server/db", () => ({ db: mockDb }));

const mockSaleAdapter = { syncSale: vi.fn(async () => {}) };
const mockCatalogAdapter = { syncVariant: vi.fn(async () => {}) };
const mockTenantProvisioner = { provision: vi.fn(async () => {}) };

const { ErpOutboxPublisher } = await import("@/server/erp/outboxPublisher");

function createEvent(overrides: Partial<PublishableEvent> = {}): PublishableEvent {
  return {
    eventId: "evt-test-1",
    eventType: "SaleCompleted",
    eventVersion: 1,
    occurredAt: new Date("2026-10-29T12:00:00.000Z"),
    tenantId: "tenant-no-site",
    storeId: "store-1",
    actorUserId: "user-1",
    correlationId: "corr-1",
    causationId: null,
    entityId: "sale-1",
    payload: {},
    ...overrides,
  };
}

describe("ErpOutboxPublisher site guard (fail closed)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fails closed when tenant has no erpnextSiteId (null): does not publish and throws ErpError", async () => {
    mockDb.tenant.findUnique.mockResolvedValueOnce({ erpnextSiteId: null });

    const publisher = new ErpOutboxPublisher(
      mockSaleAdapter as never,
      mockCatalogAdapter as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      mockTenantProvisioner as never,
      undefined as never
    );

    const event = createEvent({ tenantId: "tenant-null-site" });

    await expect(publisher.publish(event)).rejects.toThrow(ErpError);
    await expect(publisher.publish(event)).rejects.toThrow(/has no ERP site configured and cannot publish outbox events/);

    expect(mockSaleAdapter.syncSale).not.toHaveBeenCalled();
    expect(mockCatalogAdapter.syncVariant).not.toHaveBeenCalled();
    expect(mockTenantProvisioner.provision).not.toHaveBeenCalled();
  });

  it("fails closed when tenant row does not exist in the database", async () => {
    mockDb.tenant.findUnique.mockResolvedValueOnce(null);

    const publisher = new ErpOutboxPublisher(
      mockSaleAdapter as never,
      mockCatalogAdapter as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      mockTenantProvisioner as never,
      undefined as never
    );

    const event = createEvent({ tenantId: "tenant-missing" });

    await expect(publisher.publish(event)).rejects.toThrow(ErpError);
    expect(mockSaleAdapter.syncSale).not.toHaveBeenCalled();
  });

  it("allows publishing when tenant has erpnextSiteId = 'frontend'", async () => {
    mockDb.tenant.findUnique.mockResolvedValueOnce({ erpnextSiteId: "frontend" });

    const publisher = new ErpOutboxPublisher(
      mockSaleAdapter as never,
      mockCatalogAdapter as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      mockTenantProvisioner as never,
      undefined as never
    );

    const event = createEvent({ tenantId: "tenant-frontend-site", entityId: "sale-100" });

    await publisher.publish(event);

    expect(mockSaleAdapter.syncSale).toHaveBeenCalledWith("tenant-frontend-site", "sale-100", "corr-1");
  });

  it("prevents tenant provision event if tenant has no erpnextSiteId configured", async () => {
    mockDb.tenant.findUnique.mockResolvedValueOnce({ erpnextSiteId: null });

    const publisher = new ErpOutboxPublisher(
      mockSaleAdapter as never,
      mockCatalogAdapter as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      mockTenantProvisioner as never,
      undefined as never
    );

    const event = createEvent({
      tenantId: "tenant-null-site",
      eventType: "TenantProvisionRequested",
      entityId: "tenant-null-site",
    });

    await expect(publisher.publish(event)).rejects.toThrow(ErpError);
    expect(mockTenantProvisioner.provision).not.toHaveBeenCalled();
  });
});
