import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { logError, sanitizeText } from "@/lib/safeLog";
import {
  resolveOutboxPublisher,
  type OutboxPublisher,
  type PublishableEvent,
} from "@/server/events/publisher";

/**
 * The consumer half of the outbox: claim due events, publish them, record the outcome.
 *
 * Delivery is **at-least-once**, deliberately. Exactly-once across a database and a
 * separate transport is not achievable without distributed transactions; the honest design
 * is at-least-once plus idempotent consumers, which is what EVENTS.md already mandates
 * ("Consumers must be idempotent").
 *
 * Claiming uses `FOR UPDATE SKIP LOCKED`, so several dispatchers can run concurrently
 * without ever handing the same row to two of them. The claim advances `attempts` and
 * pushes `nextAttemptAt` into the future *before* publishing, which is what makes a
 * crashed dispatcher safe: the row is already scheduled, so it is retried later rather
 * than spun on immediately.
 */

/** Attempts before a row is parked as a dead letter and stops consuming dispatcher budget. */
export const MAX_ATTEMPTS = 8;

/** Exponential backoff, capped. attempt 1 -> 30s, 2 -> 60s, 3 -> 2m, ceiling 1h. */
export function backoffMs(attempt: number): number {
  const base = 30_000;
  const ceiling = 60 * 60_000;
  return Math.min(base * 2 ** Math.max(0, attempt - 1), ceiling);
}

interface ClaimedRow {
  id: string;
  tenantId: string;
  storeId: string | null;
  eventType: string;
  eventVersion: number;
  occurredAt: Date;
  actorUserId: string | null;
  correlationId: string;
  causationId: string | null;
  entityId: string | null;
  payload: unknown;
  attempts: number;
}

export interface DispatchResult {
  claimed: number;
  published: number;
  failed: number;
  deadLettered: number;
}

/**
 * Atomically claim up to `batchSize` due events.
 *
 * One statement. The inner SELECT picks unpublished, non-dead-lettered rows whose
 * `nextAttemptAt` has arrived, oldest first, locking them with SKIP LOCKED so a parallel
 * dispatcher simply takes different rows. The outer UPDATE advances the retry state and
 * returns the claimed rows in the same round trip — there is no window in which a row is
 * selected but not yet claimed.
 *
 * `tenantId` scopes the claim when supplied. Tenant isolation holds end to end: every row
 * carries a required, FK-enforced tenantId, so a per-tenant dispatcher can never observe
 * another tenant's events.
 *
 * The backoff interval is computed in SQL from the row's own pre-increment `attempts`,
 * mirroring `backoffMs` — doing it in the same statement is what keeps the claim atomic.
 */
export async function claimDueEvents(params: {
  batchSize?: number;
  tenantId?: string;
  now?: Date;
}): Promise<ClaimedRow[]> {
  const batchSize = params.batchSize ?? 20;
  const now = params.now ?? new Date();
  const tenantFilter = params.tenantId
    ? Prisma.sql`AND "tenantId" = ${params.tenantId}`
    : Prisma.empty;

  const rows = await db.$queryRaw<ClaimedRow[]>`
    UPDATE "outbox_events" AS o
       SET "attempts"      = o."attempts" + 1,
           "nextAttemptAt" = ${now} + (LEAST(3600000, 30000 * POWER(2, o."attempts")) || ' milliseconds')::interval
     WHERE o."id" IN (
       SELECT "id" FROM "outbox_events"
        WHERE "publishedAt" IS NULL
          AND "deadLetteredAt" IS NULL
          AND "nextAttemptAt" <= ${now}
          ${tenantFilter}
        ORDER BY "occurredAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
     )
    RETURNING o."id", o."tenantId", o."storeId", o."eventType", o."eventVersion",
              o."occurredAt", o."actorUserId", o."correlationId", o."causationId",
              o."entityId", o."payload", o."attempts"
  `;

  // The subquery's ORDER BY decides *which* rows are claimed — that part is guaranteed.
  // The order of rows coming back from UPDATE ... RETURNING is NOT: PostgreSQL makes no
  // such promise, and in practice this returned them shuffled about two runs in three.
  // Sorting here is what actually makes oldest-first delivery a guarantee rather than an
  // accident. `id` breaks ties so the order is fully deterministic when two events share
  // a millisecond.
  return rows.sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id),
  );
}

function toPublishable(row: ClaimedRow): PublishableEvent {
  return {
    eventId: row.id,
    eventType: row.eventType,
    eventVersion: row.eventVersion,
    occurredAt: row.occurredAt,
    tenantId: row.tenantId,
    storeId: row.storeId,
    actorUserId: row.actorUserId,
    correlationId: row.correlationId,
    causationId: row.causationId,
    entityId: row.entityId,
    payload: row.payload,
  };
}

/**
 * Reduce a thrown value to short, scrubbed text safe to store in `lastError`.
 *
 * Reuses the P0-2 sanitiser rather than a second implementation: `lastError` is persisted
 * and read back by operators, so an unscrubbed transport error would become a durable copy
 * of whatever credential it happened to embed.
 */
function safeErrorText(err: unknown): string {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return sanitizeText(text).slice(0, 500);
}

/**
 * Run one dispatch pass. Safe to call repeatedly; safe to run several in parallel.
 *
 * Never throws for a single event's failure — one bad event must not stall the batch. A
 * publish error is recorded on its own row and the pass continues.
 */
export async function dispatchOutboxOnce(params?: {
  batchSize?: number;
  tenantId?: string;
  publisher?: OutboxPublisher;
  now?: Date;
}): Promise<DispatchResult> {
  // Resolved per call, not captured at module load: the transport is a deployment
  // decision, and an unconfigured one must throw rather than quietly succeed.
  const publisher = params?.publisher ?? resolveOutboxPublisher();
  const rows = await claimDueEvents({
    batchSize: params?.batchSize,
    tenantId: params?.tenantId,
    now: params?.now,
  });

  const result: DispatchResult = { claimed: rows.length, published: 0, failed: 0, deadLettered: 0 };

  for (const row of rows) {
    try {
      await publisher.publish(toPublishable(row));
      await db.outboxEvent.update({
        where: { id: row.id },
        data: { publishedAt: new Date(), lastError: null },
      });
      result.published += 1;
    } catch (err) {
      // `attempts` was already incremented by the claim, so this is the count so far.
      const exhausted = row.attempts >= MAX_ATTEMPTS;

      await db.outboxEvent.update({
        where: { id: row.id },
        data: {
          lastError: safeErrorText(err),
          ...(exhausted ? { deadLetteredAt: new Date() } : {}),
        },
      });

      logError("outbox: publish failed", err, {
        eventId: row.id,
        eventType: row.eventType,
        tenantId: row.tenantId,
        attempts: row.attempts,
        deadLettered: exhausted,
      });

      result.failed += 1;
      if (exhausted) result.deadLettered += 1;
    }
  }

  return result;
}
