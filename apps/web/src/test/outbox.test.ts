import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Unit-level outbox behaviour: envelope construction, idempotency key derivation, retry
 * arithmetic, dead-lettering, and the guarantee that a publish failure never stalls a batch.
 *
 * The *transactional durability* claim is deliberately NOT tested here — mocked Prisma
 * cannot roll back, so a test asserting it in this file would prove nothing. That proof
 * lives in `src/test-integration/outbox.test.ts` against real PostgreSQL.
 */

const mockDb = {
  $queryRaw: vi.fn(),
  outboxEvent: { update: vi.fn() },
};

vi.mock("@/server/db", () => ({ db: mockDb }));

const { enqueueOutboxEvent, outboxIdempotencyKey, deriveOutboxEventStatus } = await import(
  "@/server/events/outbox"
);
const { dispatchOutboxOnce, backoffMs, MAX_ATTEMPTS } = await import(
  "@/server/events/outboxDispatcher"
);

/** Stand-in for a Prisma.TransactionClient — only the delegate the producer touches. */
function fakeTx() {
  return {
    outboxEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "evt-1",
        idempotencyKey: data.idempotencyKey as string,
      })),
    },
  };
}

function claimedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    tenantId: "tenant-a",
    storeId: "store-a",
    eventType: "PosDeviceCreated",
    eventVersion: 1,
    occurredAt: new Date("2026-09-12T00:00:00.000Z"),
    actorUserId: "user-a",
    correlationId: "corr-1",
    causationId: null,
    entityId: "device-1",
    payload: { code: "POS-01" },
    attempts: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.outboxEvent.update.mockResolvedValue({});
});

describe("enqueueOutboxEvent — envelope", () => {
  it("writes through the caller's transaction client, never the global db", async () => {
    const tx = fakeTx();
    await enqueueOutboxEvent(tx as never, {
      tenantId: "tenant-a",
      eventType: "PosDeviceCreated",
      correlationId: "corr-1",
      entityId: "device-1",
      payload: { code: "POS-01" },
    });

    expect(tx.outboxEvent.create).toHaveBeenCalledTimes(1);
    // The module must not reach for the global client at all — that would be the bug.
    expect(mockDb.$queryRaw).not.toHaveBeenCalled();
  });

  it("carries every field EVENTS.md requires", async () => {
    const tx = fakeTx();
    await enqueueOutboxEvent(tx as never, {
      tenantId: "tenant-a",
      storeId: "store-a",
      eventType: "InvitationAccepted",
      eventVersion: 2,
      actorUserId: "user-a",
      correlationId: "corr-1",
      causationId: "cause-1",
      entityId: "inv-1",
      payload: { email: "x@example.com" },
    });

    const data = tx.outboxEvent.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data).toMatchObject({
      tenantId: "tenant-a",
      storeId: "store-a",
      eventType: "InvitationAccepted",
      eventVersion: 2,
      actorUserId: "user-a",
      correlationId: "corr-1",
      causationId: "cause-1",
      entityId: "inv-1",
    });
    expect(data.idempotencyKey).toBeTruthy();
  });

  it("defaults version to 1 and nullable envelope fields to null", async () => {
    const tx = fakeTx();
    await enqueueOutboxEvent(tx as never, {
      tenantId: "tenant-a",
      eventType: "OnboardingCompleted",
      correlationId: "corr-1",
      payload: {},
    });

    const data = tx.outboxEvent.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.eventVersion).toBe(1);
    expect(data.storeId).toBeNull();
    expect(data.actorUserId).toBeNull();
    expect(data.causationId).toBeNull();
    expect(data.entityId).toBeNull();
  });

  it("lets a duplicate-key error escape so the business transaction aborts with it", async () => {
    const tx = fakeTx();
    tx.outboxEvent.create.mockRejectedValueOnce(Object.assign(new Error("dup"), { code: "P2002" }));

    await expect(
      enqueueOutboxEvent(tx as never, {
        tenantId: "tenant-a",
        eventType: "PosDeviceCreated",
        correlationId: "corr-1",
        entityId: "device-1",
        payload: {},
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("idempotency key", () => {
  it("is deterministic for the same business fact", () => {
    const a = outboxIdempotencyKey({ tenantId: "t1", eventType: "PosDeviceCreated", entityId: "d1" });
    const b = outboxIdempotencyKey({ tenantId: "t1", eventType: "PosDeviceCreated", entityId: "d1" });
    expect(a).toBe(b);
  });

  it("separates tenants, event types and entities", () => {
    const base = { eventType: "PosDeviceCreated", entityId: "d1" };
    const keys = new Set([
      outboxIdempotencyKey({ ...base, tenantId: "t1" }),
      outboxIdempotencyKey({ ...base, tenantId: "t2" }),
      outboxIdempotencyKey({ tenantId: "t1", eventType: "PosDeviceActivated", entityId: "d1" }),
      outboxIdempotencyKey({ tenantId: "t1", eventType: "PosDeviceCreated", entityId: "d2" }),
    ]);
    expect(keys.size).toBe(4);
  });

  it("a discriminator allows deliberate repeats of the same event for one entity", () => {
    const first = outboxIdempotencyKey({
      tenantId: "t1",
      eventType: "PosDeviceCreated",
      entityId: "d1",
    });
    const second = outboxIdempotencyKey({
      tenantId: "t1",
      eventType: "PosDeviceCreated",
      entityId: "d1",
      discriminator: "retry-2",
    });
    expect(first).not.toBe(second);
  });
});

describe("derived status", () => {
  it("is PENDING until delivered", () => {
    expect(deriveOutboxEventStatus({ publishedAt: null, deadLetteredAt: null })).toBe("PENDING");
  });
  it("is PUBLISHED once delivered", () => {
    expect(deriveOutboxEventStatus({ publishedAt: new Date(), deadLetteredAt: null })).toBe(
      "PUBLISHED",
    );
  });
  it("is DEAD_LETTERED when attempts were exhausted", () => {
    expect(deriveOutboxEventStatus({ publishedAt: null, deadLetteredAt: new Date() })).toBe(
      "DEAD_LETTERED",
    );
  });
});

describe("retry backoff", () => {
  it("grows exponentially from 30s", () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(3)).toBe(120_000);
  });

  it("is capped at one hour so a broken transport never schedules absurdly far out", () => {
    expect(backoffMs(50)).toBe(60 * 60_000);
  });
});

describe("dispatchOutboxOnce", () => {
  it("marks a delivered event published and clears the previous error", async () => {
    mockDb.$queryRaw.mockResolvedValue([claimedRow()]);
    const publisher = { publish: vi.fn(async () => {}) };

    const result = await dispatchOutboxOnce({ publisher });

    expect(result).toMatchObject({ claimed: 1, published: 1, failed: 0, deadLettered: 0 });
    const update = mockDb.outboxEvent.update.mock.calls[0]![0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(update.where.id).toBe("evt-1");
    expect(update.data.publishedAt).toBeInstanceOf(Date);
    expect(update.data.lastError).toBeNull();
  });

  it("hands the publisher the full envelope", async () => {
    mockDb.$queryRaw.mockResolvedValue([claimedRow()]);
    const publisher = { publish: vi.fn(async () => {}) };

    await dispatchOutboxOnce({ publisher });

    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "evt-1",
        eventType: "PosDeviceCreated",
        eventVersion: 1,
        tenantId: "tenant-a",
        storeId: "store-a",
        correlationId: "corr-1",
        entityId: "device-1",
      }),
    );
  });

  it("records the error and does NOT publish when the transport throws", async () => {
    mockDb.$queryRaw.mockResolvedValue([claimedRow({ attempts: 2 })]);
    const publisher = {
      publish: vi.fn(async () => {
        throw new Error("transport down");
      }),
    };

    const result = await dispatchOutboxOnce({ publisher });

    expect(result).toMatchObject({ claimed: 1, published: 0, failed: 1, deadLettered: 0 });
    const data = mockDb.outboxEvent.update.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.publishedAt).toBeUndefined();
    expect(String(data.lastError)).toContain("transport down");
    expect(data.deadLetteredAt).toBeUndefined();
  });

  it("dead-letters once the attempt ceiling is reached", async () => {
    mockDb.$queryRaw.mockResolvedValue([claimedRow({ attempts: MAX_ATTEMPTS })]);
    const publisher = {
      publish: vi.fn(async () => {
        throw new Error("still down");
      }),
    };

    const result = await dispatchOutboxOnce({ publisher });

    expect(result.deadLettered).toBe(1);
    const data = mockDb.outboxEvent.update.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.deadLetteredAt).toBeInstanceOf(Date);
  });

  it("scrubs credentials out of a transport error before persisting it", async () => {
    mockDb.$queryRaw.mockResolvedValue([claimedRow()]);
    const publisher = {
      publish: vi.fn(async () => {
        throw new Error("connect failed: postgresql://bususer:BUS_SECRET_PW@broker:5432/events");
      }),
    };

    await dispatchOutboxOnce({ publisher });

    const data = mockDb.outboxEvent.update.mock.calls[0]![0].data as Record<string, unknown>;
    expect(String(data.lastError)).not.toContain("BUS_SECRET_PW");
    expect(String(data.lastError)).not.toContain("bususer");
  });

  it("one failing event does not stall the rest of the batch", async () => {
    mockDb.$queryRaw.mockResolvedValue([
      claimedRow({ id: "evt-1" }),
      claimedRow({ id: "evt-2" }),
      claimedRow({ id: "evt-3" }),
    ]);
    const publisher = {
      publish: vi.fn(async (e: { eventId: string }) => {
        if (e.eventId === "evt-2") throw new Error("bad event");
      }),
    };

    const result = await dispatchOutboxOnce({ publisher });

    expect(result).toMatchObject({ claimed: 3, published: 2, failed: 1 });
    expect(publisher.publish).toHaveBeenCalledTimes(3);
  });

  it("does nothing when no event is due", async () => {
    mockDb.$queryRaw.mockResolvedValue([]);
    const publisher = { publish: vi.fn(async () => {}) };

    const result = await dispatchOutboxOnce({ publisher });

    expect(result).toEqual({ claimed: 0, published: 0, failed: 0, deadLettered: 0 });
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(mockDb.outboxEvent.update).not.toHaveBeenCalled();
  });
});
