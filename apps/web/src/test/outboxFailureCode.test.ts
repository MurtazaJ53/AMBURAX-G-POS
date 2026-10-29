import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublishableEvent } from "@/server/events/publisher";
import { ErpError } from "@/server/erp/errors";

const mockDb = {
  $queryRaw: vi.fn(),
  outboxEvent: {
    updateMany: vi.fn(),
  },
  tenant: {
    findUnique: vi.fn(),
  },
};

vi.mock("@/server/db", () => ({ db: mockDb }));

const { dispatchOutboxOnce } = await import("@/server/events/outboxDispatcher");

function claimedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    tenantId: "tenant-a",
    storeId: "store-a",
    eventType: "SaleCompleted",
    eventVersion: 1,
    occurredAt: new Date("2026-10-30T00:00:00.000Z"),
    actorUserId: "user-a",
    correlationId: "corr-1",
    causationId: null,
    entityId: "sale-1",
    payload: {},
    attempts: 1,
    ...overrides,
  };
}

describe("outboxFailureCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.outboxEvent.updateMany.mockResolvedValue({ count: 1 });
  });

  it("stamps ERP_SITE_NOT_SET on failureCode when error is ERP_SITE_NOT_SET", async () => {
    mockDb.$queryRaw.mockResolvedValueOnce([claimedRow({ id: "evt-missing-site" })]);

    const publisher = {
      publish: vi.fn(async () => {
        throw new ErpError({
          kind: "configuration_error",
          code: "ERP_SITE_NOT_SET",
          message: "Tenant tenant-a has no ERP site configured and cannot publish outbox events.",
          correlationId: "corr-1",
        });
      }),
    };

    const result = await dispatchOutboxOnce({ publisher });

    expect(result.failed).toBe(1);
    expect(result.deadLettered).toBe(1);

    expect(mockDb.outboxEvent.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "evt-missing-site", attempts: 1 }),
      data: expect.objectContaining({
        failureCode: "ERP_SITE_NOT_SET",
        deadLetteredAt: expect.any(Date),
      }),
    });
  });

  it("stores null for failureCode on other errors", async () => {
    mockDb.$queryRaw.mockResolvedValueOnce([claimedRow({ id: "evt-other-error" })]);

    const publisher = {
      publish: vi.fn(async () => {
        throw new Error("Generic network failure");
      }),
    };

    const result = await dispatchOutboxOnce({ publisher });

    expect(result.failed).toBe(1);

    expect(mockDb.outboxEvent.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "evt-other-error", attempts: 1 }),
      data: expect.objectContaining({
        failureCode: null,
      }),
    });
  });
});
