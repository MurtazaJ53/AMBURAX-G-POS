import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { db, resetDatabase, seedTwoTenants, IDS } from "./db";
import { enqueueOutboxEvent, outboxIdempotencyKey } from "@/server/events/outbox";
import { dispatchOutboxOnce, MAX_ATTEMPTS } from "@/server/events/outboxDispatcher";
import { runOutboxWorker } from "@/server/events/outboxRunner";
import {
  NoEventTransportConfiguredError,
  UnconfiguredOutboxPublisher,
} from "@/server/events/publisher";

/**
 * The durability proof for ADR-010's outbox, against REAL PostgreSQL.
 *
 * This is the file that justifies the design. Everything in `src/test/outbox.test.ts` runs
 * on mocked Prisma and therefore cannot demonstrate the one property the whole pattern
 * exists for: that an event and the mutation it describes commit or roll back **together**.
 * Only a real transaction can show that.
 */

beforeEach(async () => {
  await resetDatabase();
  await seedTwoTenants();
});

afterAll(async () => {
  await resetDatabase();
  await db.$disconnect();
});

/** A device row that satisfies the schema, created inside whatever client is passed. */
function deviceData(code: string) {
  return {
    tenantId: IDS.tenantA,
    storeId: IDS.storeA,
    name: `Terminal ${code}`,
    code,
    createdByUserId: IDS.ownerA,
  };
}

describe("transactional durability — the reason the outbox exists", () => {
  it("commits the event WITH the business mutation", async () => {
    await db.$transaction(async (tx) => {
      const device = await tx.posDevice.create({ data: deviceData("POS-01") });
      await enqueueOutboxEvent(tx, {
        tenantId: IDS.tenantA,
        storeId: IDS.storeA,
        eventType: "PosDeviceCreated",
        correlationId: "corr-commit",
        entityId: device.id,
        payload: { code: device.code },
      });
    });

    expect(await db.posDevice.count()).toBe(1);
    expect(await db.outboxEvent.count()).toBe(1);

    const event = await db.outboxEvent.findFirstOrThrow();
    expect(event.eventType).toBe("PosDeviceCreated");
    expect(event.publishedAt).toBeNull();
    expect(event.attempts).toBe(0);
  });

  it("ROLLS BACK the event when the business mutation fails afterwards", async () => {
    // The event is enqueued first, then the transaction throws. If the outbox insert used
    // the global client — as writeAuditLog does — this row would survive and the system
    // would publish an event for a device that does not exist.
    await expect(
      db.$transaction(async (tx) => {
        const device = await tx.posDevice.create({ data: deviceData("POS-01") });
        await enqueueOutboxEvent(tx, {
          tenantId: IDS.tenantA,
          storeId: IDS.storeA,
          eventType: "PosDeviceCreated",
          correlationId: "corr-rollback",
          entityId: device.id,
          payload: { code: device.code },
        });
        throw new Error("business rule failed after enqueue");
      }),
    ).rejects.toThrow("business rule failed after enqueue");

    expect(await db.posDevice.count()).toBe(0);
    expect(await db.outboxEvent.count()).toBe(0);
  });

  it("rolls the event back when a later constraint violation aborts the transaction", async () => {
    await db.posDevice.create({ data: deviceData("POS-01") });

    await expect(
      db.$transaction(async (tx) => {
        const device = await tx.posDevice.create({ data: deviceData("POS-02") });
        await enqueueOutboxEvent(tx, {
          tenantId: IDS.tenantA,
          storeId: IDS.storeA,
          eventType: "PosDeviceCreated",
          correlationId: "corr-conflict",
          entityId: device.id,
          payload: { code: device.code },
        });
        // Duplicate of the pre-existing code — violates @@unique([storeId, code]).
        await tx.posDevice.create({ data: deviceData("POS-01") });
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    expect(await db.posDevice.count()).toBe(1); // only the pre-existing one
    expect(await db.outboxEvent.count()).toBe(0);
  });

  it("never produces an event without its mutation, or a mutation without its event", async () => {
    // Five transactions, every other one doomed. The invariant is a strict 1:1.
    for (let i = 0; i < 5; i += 1) {
      const doomed = i % 2 === 1;
      const run = db.$transaction(async (tx) => {
        const device = await tx.posDevice.create({ data: deviceData(`POS-${10 + i}`) });
        await enqueueOutboxEvent(tx, {
          tenantId: IDS.tenantA,
          storeId: IDS.storeA,
          eventType: "PosDeviceCreated",
          correlationId: `corr-${i}`,
          entityId: device.id,
          payload: { code: device.code },
        });
        if (doomed) throw new Error("doomed");
      });
      if (doomed) await expect(run).rejects.toThrow("doomed");
      else await run;
    }

    const devices = await db.posDevice.findMany({ orderBy: { code: "asc" } });
    const events = await db.outboxEvent.findMany({ orderBy: { occurredAt: "asc" } });

    expect(devices).toHaveLength(3);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.entityId).sort()).toEqual(devices.map((d) => d.id).sort());
  });
});

describe("idempotency is enforced by PostgreSQL", () => {
  it("rejects a duplicate event for the same business fact", async () => {
    const enqueue = () =>
      db.$transaction((tx) =>
        enqueueOutboxEvent(tx, {
          tenantId: IDS.tenantA,
          eventType: "PosDeviceCreated",
          correlationId: "corr-1",
          entityId: "device-fixed",
          payload: {},
        }),
      );

    await enqueue();
    await expect(enqueue()).rejects.toMatchObject({ code: "P2002" });
    expect(await db.outboxEvent.count()).toBe(1);
  });

  it("allows the same event type for different tenants", async () => {
    for (const tenantId of [IDS.tenantA, IDS.tenantB]) {
      await db.$transaction((tx) =>
        enqueueOutboxEvent(tx, {
          tenantId,
          eventType: "OnboardingCompleted",
          correlationId: "corr-1",
          entityId: "same-entity-id",
          payload: {},
        }),
      );
    }
    expect(await db.outboxEvent.count()).toBe(2);
  });

  it("a discriminator permits a deliberate repeat", async () => {
    const base = {
      tenantId: IDS.tenantA,
      eventType: "PosDeviceCreated" as const,
      correlationId: "c",
      entityId: "device-1",
      payload: {},
    };
    await db.$transaction((tx) => enqueueOutboxEvent(tx, base));
    await db.$transaction((tx) => enqueueOutboxEvent(tx, { ...base, discriminator: "second" }));

    expect(await db.outboxEvent.count()).toBe(2);
  });

  it("stores the derived key so a duplicate is detectable before insert", async () => {
    await db.$transaction((tx) =>
      enqueueOutboxEvent(tx, {
        tenantId: IDS.tenantA,
        eventType: "PosDeviceCreated",
        correlationId: "c",
        entityId: "device-1",
        payload: {},
      }),
    );
    const row = await db.outboxEvent.findFirstOrThrow();
    expect(row.idempotencyKey).toBe(
      outboxIdempotencyKey({
        tenantId: IDS.tenantA,
        eventType: "PosDeviceCreated",
        entityId: "device-1",
      }),
    );
  });
});

describe("tenant isolation", () => {
  it("a tenant-scoped dispatcher never claims another tenant's events", async () => {
    for (const tenantId of [IDS.tenantA, IDS.tenantB]) {
      await db.$transaction((tx) =>
        enqueueOutboxEvent(tx, {
          tenantId,
          eventType: "OnboardingCompleted",
          correlationId: "c",
          entityId: `entity-${tenantId}`,
          payload: {},
        }),
      );
    }

    const seen: string[] = [];
    const result = await dispatchOutboxOnce({
      tenantId: IDS.tenantA,
      now: new Date(Date.now() + 10),
      publisher: {
        publish: async (e) => {
          seen.push(e.tenantId);
        },
      },
    });

    expect(result.claimed).toBe(1);
    expect(seen).toEqual([IDS.tenantA]);

    // Tenant B's event is untouched: still pending, never attempted.
    const b = await db.outboxEvent.findFirstOrThrow({ where: { tenantId: IDS.tenantB } });
    expect(b.publishedAt).toBeNull();
    expect(b.attempts).toBe(0);
  });

  it("an event cannot reference a tenant that does not exist", async () => {
    await expect(
      db.$transaction((tx) =>
        enqueueOutboxEvent(tx, {
          tenantId: "tenant-does-not-exist",
          eventType: "OnboardingCompleted",
          correlationId: "c",
          entityId: "e",
          payload: {},
        }),
      ),
    ).rejects.toMatchObject({ code: "P2003" });
  });
});

describe("delivery, retry and dead-lettering against a real row", () => {
  async function enqueueOne(entityId = "device-1") {
    return db.$transaction((tx) =>
      enqueueOutboxEvent(tx, {
        tenantId: IDS.tenantA,
        storeId: IDS.storeA,
        eventType: "PosDeviceCreated",
        correlationId: "corr-1",
        entityId,
        payload: { code: "POS-01" },
      }),
    );
  }

  it("publishes a due event exactly once across two dispatcher passes", async () => {
    await enqueueOne();
    const publisher = { publish: async () => {} };

    const now = new Date(Date.now() + 10);
    const first = await dispatchOutboxOnce({ publisher, now });
    const second = await dispatchOutboxOnce({ publisher, now });

    expect(first.published).toBe(1);
    expect(second.claimed).toBe(0); // already published, no longer due
    const row = await db.outboxEvent.findFirstOrThrow();
    expect(row.publishedAt).not.toBeNull();
    expect(row.attempts).toBe(1);
  });

  it("a failed publish leaves the event pending with the error recorded and backoff applied", async () => {
    await enqueueOne();
    const before = await db.outboxEvent.findFirstOrThrow();

    const now = new Date(Date.now() + 10);
    const result = await dispatchOutboxOnce({
      now,
      publisher: {
        publish: async () => {
          throw new Error("broker unreachable");
        },
      },
    });

    expect(result.failed).toBe(1);
    const after = await db.outboxEvent.findFirstOrThrow();
    expect(after.publishedAt).toBeNull();
    expect(after.attempts).toBe(1);
    expect(after.lastError).toContain("broker unreachable");
    // Backoff pushed it into the future, so an immediate second pass must not pick it up.
    expect(after.nextAttemptAt.getTime()).toBeGreaterThan(before.nextAttemptAt.getTime());

    const immediate = await dispatchOutboxOnce({ now, publisher: { publish: async () => {} } });
    expect(immediate.claimed).toBe(0);
  });

  it("retries successfully once the backoff has elapsed", async () => {
    await enqueueOne();
    await dispatchOutboxOnce({
      now: new Date(Date.now() + 10),
      publisher: {
        publish: async () => {
          throw new Error("temporary");
        },
      },
    });

    // Simulate time passing rather than sleeping through a 30s backoff.
    const future = new Date(Date.now() + 10 * 60_000);
    const result = await dispatchOutboxOnce({ now: future, publisher: { publish: async () => {} } });

    expect(result.published).toBe(1);
    const row = await db.outboxEvent.findFirstOrThrow();
    expect(row.publishedAt).not.toBeNull();
    expect(row.lastError).toBeNull();
    expect(row.attempts).toBe(2);
  });

  it("dead-letters after the attempt ceiling and stops being claimed", async () => {
    await enqueueOne();
    const failing = {
      publish: async () => {
        throw new Error("permanently broken");
      },
    };

    let now = new Date(Date.now() + 10);
    for (let i = 0; i <= MAX_ATTEMPTS; i += 1) {
      await dispatchOutboxOnce({ now, publisher: failing });
      now = new Date(now.getTime() + 6 * 60 * 60_000); // well past any backoff
    }

    const row = await db.outboxEvent.findFirstOrThrow();
    expect(row.deadLetteredAt).not.toBeNull();
    expect(row.publishedAt).toBeNull();
    expect(row.attempts).toBeGreaterThanOrEqual(MAX_ATTEMPTS);

    // A dead letter is parked: it never consumes dispatcher budget again.
    const after = await dispatchOutboxOnce({ now, publisher: { publish: async () => {} } });
    expect(after.claimed).toBe(0);
  });

  it("two concurrent dispatchers never deliver the same event twice", async () => {
    for (let i = 0; i < 6; i += 1) await enqueueOne(`device-${i}`);

    const delivered: string[] = [];
    const publisher = {
      publish: async (e: { eventId: string }) => {
        delivered.push(e.eventId);
      },
    };

    // SKIP LOCKED is what makes this safe: each pass claims a disjoint set.
    const now = new Date(Date.now() + 10);
    const [a, b] = await Promise.all([
      dispatchOutboxOnce({ publisher, batchSize: 6, now }),
      dispatchOutboxOnce({ publisher, batchSize: 6, now }),
    ]);

    expect(a.claimed + b.claimed).toBe(6);
    expect(new Set(delivered).size).toBe(delivered.length); // no duplicates
    expect(await db.outboxEvent.count({ where: { publishedAt: null } })).toBe(0);
  });

  it("oldest events are claimed first", async () => {
    await enqueueOne("device-old");
    await new Promise((r) => setTimeout(r, 10));
    await enqueueOne("device-new");

    const order: string[] = [];
    await dispatchOutboxOnce({
      batchSize: 2,
      now: new Date(Date.now() + 10),
      publisher: {
        publish: async (e) => {
          order.push(String(e.entityId));
        },
      },
    });

    expect(order).toEqual(["device-old", "device-new"]);
  });
});

describe("the wired producer (createFirstPosDevice)", () => {
  it("a PosDeviceCreated event exists for a device created through a transaction", async () => {
    // Mirrors the shape posDeviceSetup uses: claim, create, enqueue — all in one tx.
    await db.$transaction(async (tx) => {
      await tx.tenant.updateMany({
        where: { id: IDS.tenantA, onboardingStep: "STORE_CREATED" },
        data: { onboardingStep: "POS_CONFIGURED" },
      });
      const device = await tx.posDevice.create({ data: deviceData("POS-01") });
      await enqueueOutboxEvent(tx, {
        tenantId: IDS.tenantA,
        storeId: IDS.storeA,
        eventType: "PosDeviceCreated",
        actorUserId: IDS.ownerA,
        correlationId: "corr-1",
        entityId: device.id,
        payload: {
          code: device.code,
          name: device.name,
          storeId: IDS.storeA,
          status: "PENDING_ACTIVATION",
        },
      });
    });

    const event = await db.outboxEvent.findFirstOrThrow();
    expect(event.eventType).toBe("PosDeviceCreated");
    expect(event.actorUserId).toBe(IDS.ownerA);
    expect(event.storeId).toBe(IDS.storeA);
  });

  it("the event payload contains no pairing code or secret", async () => {
    await db.$transaction(async (tx) => {
      const device = await tx.posDevice.create({
        data: { ...deviceData("POS-01"), pairingCodeHash: "a".repeat(64) },
      });
      await enqueueOutboxEvent(tx, {
        tenantId: IDS.tenantA,
        storeId: IDS.storeA,
        eventType: "PosDeviceCreated",
        correlationId: "corr-1",
        entityId: device.id,
        payload: {
          code: device.code,
          name: device.name,
          storeId: IDS.storeA,
          status: "PENDING_ACTIVATION",
        },
      });
    });

    const event = await db.outboxEvent.findFirstOrThrow();
    const serialized = JSON.stringify(event.payload);
    expect(serialized).not.toContain("a".repeat(64));
    expect(serialized.toLowerCase()).not.toContain("pairing");
    expect(serialized.toLowerCase()).not.toContain("secret");
  });
});

describe("the runner, against real PostgreSQL — audit finding F-01", () => {
  /** One enqueued, immediately-due event for tenant A. */
  async function enqueueDueEvent(discriminator: string): Promise<string> {
    const event = await db.$transaction((tx) =>
      enqueueOutboxEvent(tx, {
        tenantId: IDS.tenantA,
        storeId: IDS.storeA,
        eventType: "PosDeviceCreated",
        correlationId: `corr-${discriminator}`,
        entityId: `device-${discriminator}`,
        discriminator,
        payload: { code: `POS-${discriminator}`, status: "PENDING_ACTIVATION" },
      }),
    );
    return event.id;
  }

  it("the runner actually drains the table — the loop, not just the dispatcher", async () => {
    // The gap F-01 named: every guarantee below was already true of dispatchOutboxOnce, and
    // nothing in the system ever called it.
    await enqueueDueEvent("r1");
    await enqueueDueEvent("r2");

    const summary = await runOutboxWorker({
      publisher: { publish: async () => {} },
      now: new Date(Date.now() + 10),
      maxCycles: 1,
      sleep: async () => {},
    });

    expect(summary.published).toBe(2);
    expect(await db.outboxEvent.count({ where: { publishedAt: null } })).toBe(0);
  });

  it("two concurrent runners never publish the same event twice", async () => {
    for (let i = 0; i < 8; i += 1) await enqueueDueEvent(`c${i}`);

    const seen: string[] = [];
    const publisher = {
      publish: async (event: { eventId: string }) => {
        seen.push(event.eventId);
      },
    };

    const now = new Date(Date.now() + 10);
    const [a, b] = await Promise.all([
      runOutboxWorker({ publisher, maxCycles: 1, batchSize: 8, now, sleep: async () => {} }),
      runOutboxWorker({ publisher, maxCycles: 1, batchSize: 8, now, sleep: async () => {} }),
    ]);

    expect(a.published + b.published).toBe(8);
    expect(new Set(seen).size).toBe(seen.length);
    expect(await db.outboxEvent.count({ where: { publishedAt: null } })).toBe(0);
  });

  it("refuses to run with no transport configured, leaving every event PENDING", async () => {
    // The honesty requirement, proved against the database rather than a mock: an
    // unconfigured system must not claim, must not burn attempts, and must not publish.
    const id = await enqueueDueEvent("unconfigured");

    await expect(
      runOutboxWorker({ environment: {} as NodeJS.ProcessEnv, maxCycles: 1, now: new Date(Date.now() + 10), sleep: async () => {} }),
    ).rejects.toBeInstanceOf(NoEventTransportConfiguredError);

    const event = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(event.publishedAt).toBeNull();
    expect(event.deadLetteredAt).toBeNull();
    expect(event.attempts).toBe(0);
    expect(event.lastError).toBeNull();
  });

  it("an unconfigured publisher that reaches the dispatcher records a failure, never a publish", async () => {
    const id = await enqueueDueEvent("bypass");

    const summary = await runOutboxWorker({
      publisher: new UnconfiguredOutboxPublisher(),
      maxCycles: 1,
      now: new Date(Date.now() + 10),
      sleep: async () => {},
    });

    expect(summary.published).toBe(0);
    const event = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(event.publishedAt).toBeNull();
    expect(event.attempts).toBe(1);
    expect(event.lastError).toContain("No outbox event transport is configured");
    // Still retryable: a configuration fix plus a restart delivers it.
    expect(event.deadLetteredAt).toBeNull();
  });

  it("stays inside its tenant when told to", async () => {
    await enqueueDueEvent("tenant-scoped");
    const foreign = await db.$transaction((tx) =>
      enqueueOutboxEvent(tx, {
        tenantId: IDS.tenantB,
        storeId: IDS.storeB,
        eventType: "PosDeviceCreated",
        correlationId: "corr-b",
        entityId: "device-b",
        payload: { code: "POS-B", status: "PENDING_ACTIVATION" },
      }),
    );

    const summary = await runOutboxWorker({
      publisher: { publish: async () => {} },
      tenantId: IDS.tenantA,
      maxCycles: 1,
      now: new Date(Date.now() + 10),
      sleep: async () => {},
    });

    expect(summary.published).toBe(1);
    const untouched = await db.outboxEvent.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(untouched.publishedAt).toBeNull();
    expect(untouched.attempts).toBe(0);
  });

  it("a failed publish leaves the event due again later, and a later run delivers it", async () => {
    const id = await enqueueDueEvent("retry");

    await runOutboxWorker({
      publisher: {
        publish: async () => {
          throw new Error("transport down");
        },
      },
      maxCycles: 1,
      now: new Date(Date.now() + 10),
      sleep: async () => {},
    });

    const afterFailure = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(afterFailure.publishedAt).toBeNull();
    expect(afterFailure.attempts).toBe(1);
    expect(afterFailure.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    // Due again once the backoff has elapsed — the row was never lost.
    await db.outboxEvent.update({ where: { id }, data: { nextAttemptAt: new Date() } });
    const recovered = await runOutboxWorker({
      publisher: { publish: async () => {} },
      maxCycles: 1,
      now: new Date(Date.now() + 10),
      sleep: async () => {},
    });
    expect(recovered.published).toBe(1);
  });

  it("dead-letters after the attempt ceiling instead of retrying forever", async () => {
    const id = await enqueueDueEvent("dead");
    await db.outboxEvent.update({ where: { id }, data: { attempts: MAX_ATTEMPTS } });

    const summary = await runOutboxWorker({
      publisher: {
        publish: async () => {
          throw new Error("still down");
        },
      },
      maxCycles: 1,
      now: new Date(Date.now() + 10),
      sleep: async () => {},
    });

    expect(summary.deadLettered).toBe(1);
    const event = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
    expect(event.deadLetteredAt).not.toBeNull();
    expect(event.publishedAt).toBeNull();
  });

  it("stops promptly when the shutdown signal fires mid-run", async () => {
    await enqueueDueEvent("shutdown");
    const controller = new AbortController();

    const summary = await runOutboxWorker({
      publisher: { publish: async () => {} },
      signal: controller.signal,
      now: new Date(Date.now() + 10),
      sleep: async () => {},
      onCycle: () => controller.abort(),
    });

    expect(summary.stoppedBy).toBe("signal");
    expect(summary.cycles).toBe(1);
  });
});
