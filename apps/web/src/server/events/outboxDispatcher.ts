import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { logError, sanitizeText } from "@/lib/safeLog";
import { ErpError } from "@/server/erp/errors";
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
  /** Claims this pass lost to another dispatcher before it could record a result. */
  lostClaims: number;
}

/**
 * Claim lease while a publish runs. The claim pushes `nextAttemptAt` at least 30 s ahead; a
 * publish is several ERPNext calls of up to 15 s each, so it can outlast that. While one runs,
 * a heartbeat keeps `nextAttemptAt` at least LEASE_MS ahead, so no other dispatcher can claim
 * the row. If this process stalls or dies, the heartbeat stops and the lease expires on its own.
 */
export const LEASE_MS = 30_000;
export const HEARTBEAT_MS = 10_000;

type Clock = Date | (() => Date) | undefined;

/** The claim clock: a caller's (tests) or the database's, the same one claimDueEvents uses. */
function clockSql(now: Clock) {
  if (now === undefined) return Prisma.sql`(clock_timestamp() AT TIME ZONE 'UTC')`;
  return Prisma.sql`${typeof now === "function" ? now() : now}`;
}

/**
 * Extend a claim's lease, only while this dispatcher still holds it. The claim token is the
 * row's `attempts` at claim time: any later claim increments it, so a stale holder's renewal
 * matches nothing. GREATEST keeps a longer retry backoff from being shortened.
 */
async function renewLease(row: ClaimedRow, leaseMs: number, now: Clock): Promise<void> {
  await db.$executeRaw`
    UPDATE "outbox_events"
       SET "nextAttemptAt" = GREATEST("nextAttemptAt", ${clockSql(now)} + make_interval(secs => ${leaseMs}::double precision / 1000))
     WHERE "id" = ${row.id} AND "attempts" = ${row.attempts} AND "publishedAt" IS NULL
  `;
}

/**
 * Atomically claim up to `batchSize` due events.
 *
 * One statement. `candidates` picks unpublished, non-dead-lettered rows whose
 * `nextAttemptAt` has arrived, oldest first. `locked` then locks those rows *in the
 * outbox_events table itself* with SKIP LOCKED, re-checking that each is still claimable, so
 * a parallel dispatcher simply takes different rows. The outer UPDATE advances the retry
 * state and returns the claimed rows in the same round trip.
 *
 * The lock must be taken on a table, not on a CTE: PostgreSQL ignores a locking clause for
 * WITH queries it references, so `FOR UPDATE` on `candidates` (which reads the ranked CTE)
 * locked nothing, and two dispatchers could each claim and publish the same row. The
 * re-check matters too: under READ COMMITTED a row a parallel dispatcher has just claimed and
 * committed is re-read at lock time, and its advanced `nextAttemptAt` now excludes it.
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
  // One clock for "is it due": the database's. `nextAttemptAt` defaults to the database's now(), so
  // comparing it with the app server's clock let any skew (Docker's clock runs ~0.3 s ahead here)
  // hold back a just-created event. Columns are UTC timestamps without zone, hence AT TIME ZONE.
  // A caller-supplied `now` (tests) is used as given.
  const now = params.now ? Prisma.sql`${params.now}` : Prisma.sql`(clock_timestamp() AT TIME ZONE 'UTC')`;
  const tenantFilter = params.tenantId
    ? Prisma.sql`AND "tenantId" = ${params.tenantId}`
    : Prisma.empty;

  const rows = await db.$queryRaw<ClaimedRow[]>`
    WITH unpaused_tenants AS (
      SELECT id FROM "tenants" WHERE "isSyncPaused" = false
    ),
    -- Rank ALL unpublished events per tenant first so an earlier event waiting after failure
    -- blocks any subsequent dependent events from jumping ahead of it.
    all_unpublished_ranked AS (
      SELECT 
        o.id, 
        o."tenantId", 
        o."occurredAt",
        o."nextAttemptAt",
        ROW_NUMBER() OVER (
          PARTITION BY o."tenantId" 
          ORDER BY o."occurredAt" ASC, o."id" ASC
        ) AS tenant_seq
      FROM "outbox_events" o
      JOIN unpaused_tenants t ON t.id = o."tenantId"
      WHERE o."publishedAt" IS NULL
        AND o."deadLetteredAt" IS NULL
        ${tenantFilter}
    ),
    -- Find the earliest sequence per tenant that is NOT yet due (waiting after a transient failure)
    blocked_tenants AS (
      SELECT "tenantId", MIN(tenant_seq) as first_waiting_seq
      FROM all_unpublished_ranked
      WHERE "nextAttemptAt" > ${now}
      GROUP BY "tenantId"
    ),
    candidates AS (
      SELECT a.id, a."occurredAt", a.id as tie_id
      FROM all_unpublished_ranked a
      LEFT JOIN blocked_tenants b ON b."tenantId" = a."tenantId"
      WHERE a.tenant_seq <= 20
        AND a."nextAttemptAt" <= ${now}
        -- If an earlier event is waiting, DO NOT claim any later event for this tenant!
        AND (b.first_waiting_seq IS NULL OR a.tenant_seq < b.first_waiting_seq)
      ORDER BY a."occurredAt" ASC, a.id ASC
      LIMIT ${batchSize}
    ),
    locked AS (
      SELECT e.id
      FROM "outbox_events" e
      WHERE e.id IN (SELECT id FROM candidates)
        AND e."publishedAt" IS NULL
        AND e."deadLetteredAt" IS NULL
        AND e."nextAttemptAt" <= ${now}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "outbox_events" AS o
       SET "attempts"      = o."attempts" + 1,
           "nextAttemptAt" = ${now} + (LEAST(3600000, 30000 * POWER(2, o."attempts")) || ' milliseconds')::interval
     WHERE o."id" IN (SELECT id FROM locked)
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
  /** Tests only: a fixed time, or a function read at claim and at every lease renewal. */
  now?: Clock;
  /** Lease renewal interval while a publish runs; 0 turns renewal off (tests). */
  heartbeatMs?: number;
  leaseMs?: number;
}): Promise<DispatchResult> {
  // Resolved per call, not captured at module load: the transport is a deployment
  // decision, and an unconfigured one must throw rather than quietly succeed.
  const publisher = params?.publisher ?? resolveOutboxPublisher();
  const heartbeatMs = params?.heartbeatMs ?? HEARTBEAT_MS;
  const leaseMs = params?.leaseMs ?? LEASE_MS;
  const rows = await claimDueEvents({
    batchSize: params?.batchSize,
    tenantId: params?.tenantId,
    now: typeof params?.now === "function" ? params.now() : params?.now,
  });

  const result: DispatchResult = { claimed: rows.length, published: 0, failed: 0, deadLettered: 0, lostClaims: 0 };

  /** Publish while renewing the claim's lease, so a slow publish is never claimed twice. */
  async function publishUnderLease(row: ClaimedRow): Promise<void> {
    const timer =
      heartbeatMs > 0
        ? setInterval(() => {
            renewLease(row, leaseMs, params?.now).catch((err) =>
              logError("outbox: lease renewal failed", err, { eventId: row.id }),
            );
          }, heartbeatMs)
        : null;
    try {
      await publisher.publish(toPublishable(row));
    } finally {
      if (timer) clearInterval(timer);
    }
  }

  // Results are recorded only while this pass still holds the claim (same `attempts`, not yet
  // published). A dispatcher that stalled past its lease must not overwrite the outcome of
  // the dispatcher that took the row over.
  const stillOurs = (row: ClaimedRow) => ({ id: row.id, attempts: row.attempts, publishedAt: null });
  function claimLost(row: ClaimedRow, stage: string) {
    result.lostClaims += 1;
    logError("outbox: claim lost before the result was recorded", new Error(stage), {
      eventId: row.id,
      eventType: row.eventType,
      tenantId: row.tenantId,
      attempts: row.attempts,
    });
  }

  for (const row of rows) {
    try {
      await publishUnderLease(row);
      const written = await db.outboxEvent.updateMany({
        where: stillOurs(row),
        data: { publishedAt: new Date(), lastError: null },
      });
      if (written.count === 1) result.published += 1;
      else claimLost(row, "published");
    } catch (err) {
      // Classify Permanent vs. Transient Errors per reviewer specification:
      // Permanent errors (statutory validation failures, fiscal year setup errors, unsupported config):
      // -> Dead-letter immediately on attempt 1.
      // Dependency / Not Found errors (e.g. Item not yet in ERPNext, waiting for variant sync):
      // -> Retried with backoff so the preceding Item creation event has a chance to complete.
      // Transient errors (timeouts, 5xx server errors, rate limits 429):
      // -> Retried with exponential backoff up to MAX_ATTEMPTS (or 24 hours).
      const errMsg = err instanceof Error ? err.message : String(err);
      const isMissingWarehouse = errMsg.includes("has no ERP warehouse provisioned");
      const isMissingValuation = errMsg.includes("no valuation cost recorded");
      const isFiscalYearError = errMsg.includes("not in any active Fiscal Year");
      const isStatutoryValidationError = errMsg.includes("tax treatment UNSPECIFIED");
      const isPermanentConfig = err instanceof ErpError && (err.kind === "configuration_error" || err.kind === "unsupported_version");
      const isMissingItemDependency = errMsg.includes("Could not find Row #1: Item Code") || errMsg.includes("Item Code does not exist") || (err instanceof ErpError && err.kind === "not_found");
      
      const isUnrecoverable = !isMissingItemDependency && (isMissingWarehouse || isMissingValuation || isFiscalYearError || isStatutoryValidationError || isPermanentConfig || (err instanceof ErpError && !err.retryable));
      const exhausted = isUnrecoverable || row.attempts >= MAX_ATTEMPTS;

      const written = await db.outboxEvent.updateMany({
        where: stillOurs(row),
        data: {
          lastError: safeErrorText(err),
          ...(exhausted ? { deadLetteredAt: new Date() } : {}),
        },
      });
      if (written.count === 0) {
        claimLost(row, "failed");
        continue;
      }

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
