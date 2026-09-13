import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Runner behaviour that does not need a database: startup refusal, loop control, shutdown,
 * error containment, and the publisher-resolution rules.
 *
 * The loop is tested by calling it directly with an injected sleep and a bounded
 * `maxCycles`, rather than by spawning `outbox:work` and watching stdout. Spawning would
 * test tsx, the shell and the process supervisor as much as the logic, and would make a
 * failure hard to localise. The one thing that genuinely needs the entry point — its exit
 * code — is covered by calling `main()` directly.
 *
 * The durability half of these guarantees (claims, retries and dead-lettering against real
 * PostgreSQL) lives in `src/test-integration/outbox.test.ts`.
 */

const mockDb = {
  $queryRaw: vi.fn(),
  $disconnect: vi.fn(async () => {}),
  outboxEvent: { update: vi.fn() },
};

vi.mock("@/server/db", () => ({ db: mockDb }));

const { runOutboxWorker, assertTransportConfigured, interruptibleSleep, describeRunnerStartup } =
  await import("@/server/events/outboxRunner");

const {
  describeOutboxTransport,
  resolveOutboxPublisher,
  UnconfiguredOutboxPublisher,
  ConsoleOutboxPublisher,
  NoEventTransportConfiguredError,
} = await import("@/server/events/publisher");

const { main, EXIT_NO_TRANSPORT } = await import("@/server/events/outboxWorker");

function claimedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    tenantId: "tenant-a",
    storeId: "store-a",
    eventType: "SaleCompleted",
    eventVersion: 1,
    occurredAt: new Date("2026-09-13T00:00:00.000Z"),
    actorUserId: "user-a",
    correlationId: "corr-1",
    causationId: null,
    entityId: "sale-1",
    payload: { billNumber: "B-1" },
    attempts: 1,
    ...overrides,
  };
}

/** A publisher that records what it was asked to deliver. */
function recordingPublisher() {
  const seen: string[] = [];
  return {
    seen,
    publish: vi.fn(async (event: { eventId: string }) => {
      seen.push(event.eventId);
    }),
  };
}

const noSleep = vi.fn(async () => {});

/**
 * A ProcessEnv for one scenario. Built from the real one so NODE_ENV and friends are
 * present, with OUTBOX_TRANSPORT cleared first — "no transport configured" is the case
 * under test most often, and inheriting a developer's value would quietly defeat it.
 */
function envWith(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { ...process.env, OUTBOX_TRANSPORT: undefined, ...overrides } as NodeJS.ProcessEnv;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.$queryRaw.mockResolvedValue([]);
  mockDb.outboxEvent.update.mockResolvedValue({});
});

describe("transport configuration", () => {
  it("treats an unset transport as no transport", () => {
    const described = describeOutboxTransport(envWith());
    expect(described.kind).toBe("none");
    expect(described.deliversForReal).toBe(false);
  });

  it("never claims real delivery, even for the dev stand-in", () => {
    const described = describeOutboxTransport(envWith({ OUTBOX_TRANSPORT: "console" }));
    expect(described.kind).toBe("console");
    // The point of the whole exercise: a local log line is not delivery.
    expect(described.deliversForReal).toBe(false);
  });

  it("refuses the console stand-in in production rather than silently accepting it", () => {
    const described = describeOutboxTransport(envWith({ OUTBOX_TRANSPORT: "console", NODE_ENV: "production" }));
    expect(described.kind).toBe("none");
  });

  it("treats an unrecognised transport name as no transport, not as a default", () => {
    expect(describeOutboxTransport(envWith({ OUTBOX_TRANSPORT: "kafka" })).kind).toBe(
      "none",
    );
  });

  it("resolves to a publisher that throws when nothing is configured", async () => {
    const publisher = resolveOutboxPublisher(envWith());
    expect(publisher).toBeInstanceOf(UnconfiguredOutboxPublisher);
    await expect(
      publisher.publish({
        eventId: "e",
        eventType: "SaleCompleted",
        eventVersion: 1,
        occurredAt: new Date(),
        tenantId: "t",
        storeId: null,
        actorUserId: null,
        correlationId: "c",
        causationId: null,
        entityId: null,
        payload: {},
      }),
    ).rejects.toBeInstanceOf(NoEventTransportConfiguredError);
  });

  it("resolves to the console stand-in only when it is explicitly asked for", () => {
    expect(resolveOutboxPublisher(envWith({ OUTBOX_TRANSPORT: "console" }))).toBeInstanceOf(
      ConsoleOutboxPublisher,
    );
  });

  it("assertTransportConfigured throws the identifiable configuration error", () => {
    expect(() => assertTransportConfigured(envWith())).toThrow(
      NoEventTransportConfiguredError,
    );
  });
});

describe("runner startup safety", () => {
  it("refuses to claim anything when no transport is configured", async () => {
    // The critical assertion behind F-01: an unconfigured system must leave events PENDING
    // rather than claim them, burn eight attempts each and dead-letter the lot.
    await expect(
      runOutboxWorker({ environment: envWith(), maxCycles: 1, sleep: noSleep }),
    ).rejects.toBeInstanceOf(NoEventTransportConfiguredError);

    expect(mockDb.$queryRaw).not.toHaveBeenCalled();
    expect(mockDb.outboxEvent.update).not.toHaveBeenCalled();
  });

  it("the worker entry point exits 78 rather than 0 when there is no transport", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await main();
    expect(code).toBe(EXIT_NO_TRANSPORT);
    expect(mockDb.$queryRaw).not.toHaveBeenCalled();
    stderr.mockRestore();
  });

  it("startup line states the transport and that it does not deliver for real", () => {
    const line = JSON.parse(
      describeRunnerStartup(
        describeOutboxTransport(envWith({ OUTBOX_TRANSPORT: "console" })),
      ),
    );
    expect(line.transport).toBe("console");
    expect(line.deliversForReal).toBe(false);
  });
});

describe("runner loop", () => {
  it("invokes the dispatcher and publishes a due event", async () => {
    mockDb.$queryRaw.mockResolvedValueOnce([claimedRow()]);
    const publisher = recordingPublisher();

    const summary = await runOutboxWorker({ publisher, maxCycles: 1, sleep: noSleep });

    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(summary.published).toBe(1);
    expect(summary.cycles).toBe(1);
    expect(summary.stoppedBy).toBe("max-cycles");
  });

  it("runs repeatedly — a later pass picks up what an earlier one could not see", async () => {
    mockDb.$queryRaw
      .mockResolvedValueOnce([claimedRow({ id: "evt-1" })])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([claimedRow({ id: "evt-2" })]);
    const publisher = recordingPublisher();

    const summary = await runOutboxWorker({ publisher, maxCycles: 3, sleep: noSleep });

    expect(summary.cycles).toBe(3);
    expect(publisher.seen).toEqual(["evt-1", "evt-2"]);
  });

  it("is safe to run twice over — a second run repeats without special-casing", async () => {
    mockDb.$queryRaw.mockResolvedValue([]);
    const publisher = recordingPublisher();

    const first = await runOutboxWorker({ publisher, maxCycles: 2, sleep: noSleep });
    const second = await runOutboxWorker({ publisher, maxCycles: 2, sleep: noSleep });

    expect(first.cycles).toBe(2);
    expect(second.cycles).toBe(2);
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it("passes a tenant filter straight through to the claim", async () => {
    mockDb.$queryRaw.mockResolvedValueOnce([]);
    await runOutboxWorker({
      publisher: recordingPublisher(),
      tenantId: "tenant-b",
      maxCycles: 1,
      sleep: noSleep,
    });

    // The claim is a tagged template; the tenant id travels as a bound parameter.
    expect(JSON.stringify(mockDb.$queryRaw.mock.calls[0])).toContain("tenant-b");
  });

  it("a failing publisher leaves the event unpublished and does not stop the loop", async () => {
    mockDb.$queryRaw.mockResolvedValueOnce([claimedRow({ attempts: 2 })]).mockResolvedValueOnce([]);
    const publisher = {
      publish: vi.fn(async () => {
        throw new Error("transport down");
      }),
    };

    const summary = await runOutboxWorker({ publisher, maxCycles: 2, sleep: noSleep });

    expect(summary.failed).toBe(1);
    expect(summary.published).toBe(0);
    expect(summary.deadLettered).toBe(0);
    expect(summary.cycles).toBe(2);

    // The row is marked with an error but NOT with publishedAt — it stays retryable.
    const update = mockDb.outboxEvent.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(update.data).not.toHaveProperty("publishedAt");
    expect(update.data).not.toHaveProperty("deadLetteredAt");
    expect(update.data.lastError).toContain("transport down");
  });

  it("an unconfigured publisher reaching the dispatcher cannot mark an event published", async () => {
    // Defence in depth: even when the startup guard is bypassed by passing a publisher
    // explicitly, the event must not be recorded as delivered.
    mockDb.$queryRaw.mockResolvedValueOnce([claimedRow()]);

    const summary = await runOutboxWorker({
      publisher: new UnconfiguredOutboxPublisher(),
      maxCycles: 1,
      sleep: noSleep,
    });

    expect(summary.published).toBe(0);
    expect(summary.failed).toBe(1);
    const update = mockDb.outboxEvent.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(update.data).not.toHaveProperty("publishedAt");
    expect(String(update.data.lastError)).toContain("No outbox event transport is configured");
  });

  it("dead-letters through the runner once attempts are exhausted", async () => {
    mockDb.$queryRaw.mockResolvedValueOnce([claimedRow({ attempts: 8 })]);
    const publisher = {
      publish: vi.fn(async () => {
        throw new Error("still down");
      }),
    };

    const summary = await runOutboxWorker({ publisher, maxCycles: 1, sleep: noSleep });

    expect(summary.deadLettered).toBe(1);
    const update = mockDb.outboxEvent.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(update.data).toHaveProperty("deadLetteredAt");
    expect(update.data).not.toHaveProperty("publishedAt");
  });

  it("survives a pass that throws outright and backs off instead of hot-looping", async () => {
    mockDb.$queryRaw
      .mockRejectedValueOnce(new Error("connection terminated"))
      .mockResolvedValueOnce([claimedRow({ id: "evt-after-outage" })]);
    const publisher = recordingPublisher();
    const sleeps: number[] = [];

    const summary = await runOutboxWorker({
      publisher,
      maxCycles: 2,
      intervalMs: 5_000,
      errorBackoffMs: 15_000,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(summary.errors).toBe(1);
    expect(summary.published).toBe(1);
    expect(sleeps).toEqual([15_000]);
    expect(publisher.seen).toEqual(["evt-after-outage"]);
  });

  it("does not leak secrets from a failing pass into the log", async () => {
    const logged: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
      logged.push(...args);
    });
    mockDb.$queryRaw.mockRejectedValueOnce(
      new Error("connect failed for postgresql://amburax:hunter2solongpassword@localhost:55432/db"),
    );

    await runOutboxWorker({ publisher: recordingPublisher(), maxCycles: 1, sleep: noSleep });

    const text = JSON.stringify(logged);
    expect(text).not.toContain("hunter2solongpassword");
    expect(text).toContain("[redacted]");
    spy.mockRestore();
  });
});

describe("graceful shutdown", () => {
  it("stops at the next safe point when the signal aborts", async () => {
    mockDb.$queryRaw.mockResolvedValue([]);
    const controller = new AbortController();

    const summary = await runOutboxWorker({
      publisher: recordingPublisher(),
      signal: controller.signal,
      sleep: noSleep,
      onCycle: (_result, cycle) => {
        if (cycle === 2) controller.abort();
      },
    });

    expect(summary.cycles).toBe(2);
    expect(summary.stoppedBy).toBe("signal");
  });

  it("does not start a pass at all when it is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const summary = await runOutboxWorker({
      publisher: recordingPublisher(),
      signal: controller.signal,
      sleep: noSleep,
    });

    expect(summary.cycles).toBe(0);
    expect(mockDb.$queryRaw).not.toHaveBeenCalled();
  });

  it("interruptibleSleep resolves immediately on abort rather than waiting out the interval", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const pending = interruptibleSleep(30_000, controller.signal);
    controller.abort();
    await pending;
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
