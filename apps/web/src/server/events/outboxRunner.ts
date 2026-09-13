import { logError, sanitizeText } from "@/lib/safeLog";
import { dispatchOutboxOnce, type DispatchResult } from "@/server/events/outboxDispatcher";
import {
  describeOutboxTransport,
  NoEventTransportConfiguredError,
  resolveOutboxPublisher,
  type OutboxPublisher,
  type OutboxTransportDescription,
} from "@/server/events/publisher";

/**
 * The thing that actually calls the dispatcher. Closes audit finding F-01.
 *
 * The outbox was durable, claimed safely, retried with backoff and dead-lettered correctly —
 * and `dispatchOutboxOnce` had exactly zero callers outside the test suite. Every guarantee
 * the dispatcher tests prove was proof about code production never ran. This module is the
 * missing half: a loop that can be run as its own process, and that fails loudly rather than
 * pretending when there is nothing to publish to.
 *
 * Deliberately NOT invoked from a page render or an API request. Dispatch is a background
 * concern with its own lifetime, concurrency and failure story; attaching it to a user
 * request would make checkout latency depend on a transport outage and would scale the
 * number of dispatchers with traffic rather than with need. It lives in `outboxWorker.ts` as
 * a standalone entry point instead.
 *
 * Concurrency safety is not this module's invention: the claim uses `FOR UPDATE SKIP LOCKED`
 * (see `outboxDispatcher.ts`), so several runners on several hosts simply take different
 * rows. Running two of these is a scaling decision, not a hazard.
 */

/** Interval between passes. */
export const DEFAULT_IDLE_INTERVAL_MS = 5_000;

/** Pause after a pass that threw, so an outage does not become a hot loop against the DB. */
export const DEFAULT_ERROR_BACKOFF_MS = 15_000;

export interface OutboxRunnerOptions {
  /** Overridden in tests; defaults to whatever the environment configures. */
  publisher?: OutboxPublisher;
  batchSize?: number;
  /** Restrict this runner to one tenant. Unset means all tenants. */
  tenantId?: string;
  intervalMs?: number;
  errorBackoffMs?: number;
  /**
   * Stop after this many passes. Undefined means run until stopped — the production
   * default. Tests pass a finite value so the loop is an ordinary awaited call rather than
   * something that has to be raced against a timer.
   */
  maxCycles?: number;
  /** Graceful shutdown. Aborting stops the loop at the next safe point. */
  signal?: AbortSignal;
  /** Injectable so tests do not spend real seconds sleeping. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Called after each pass. Observability hook; also how tests watch progress. */
  onCycle?: (result: DispatchResult, cycle: number) => void;
  environment?: NodeJS.ProcessEnv;
}

export interface OutboxRunnerSummary {
  cycles: number;
  claimed: number;
  published: number;
  failed: number;
  deadLettered: number;
  /** Passes that threw outright — a database outage, not a single event's publish failure. */
  errors: number;
  stoppedBy: "signal" | "max-cycles";
}

/**
 * Sleep that wakes early when the run is aborted, so shutdown is prompt rather than
 * "whenever the current interval happens to elapse".
 */
export function interruptibleSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

/**
 * Refuse to run when nothing can actually be delivered.
 *
 * This is the load-bearing half of the honesty fix. With no transport configured the
 * publisher throws, which would mean every claimed event burns an attempt and, after
 * `MAX_ATTEMPTS`, lands dead-lettered — turning "we have not set up a broker yet" into a
 * table full of permanently failed events. Refusing to claim anything leaves them PENDING,
 * which is the truthful description of their status.
 */
export function assertTransportConfigured(
  environment: NodeJS.ProcessEnv = process.env,
): OutboxTransportDescription {
  const transport = describeOutboxTransport(environment);
  if (transport.kind === "none") throw new NoEventTransportConfiguredError();
  return transport;
}

/**
 * Run dispatch passes until stopped.
 *
 * Errors from a single pass are contained: the loop records them, waits out
 * `errorBackoffMs`, and continues. A dispatcher that dies because the database blinked is
 * worse than one that keeps trying — and `dispatchOutboxOnce` already contains individual
 * event failures itself, so reaching this catch means something broader went wrong.
 */
export async function runOutboxWorker(
  options: OutboxRunnerOptions = {},
): Promise<OutboxRunnerSummary> {
  const environment = options.environment ?? process.env;
  const sleep = options.sleep ?? interruptibleSleep;
  const intervalMs = options.intervalMs ?? DEFAULT_IDLE_INTERVAL_MS;
  const errorBackoffMs = options.errorBackoffMs ?? DEFAULT_ERROR_BACKOFF_MS;

  // Checked before the first claim, and only when the caller has not supplied its own
  // publisher — passing one explicitly is the caller taking responsibility for delivery.
  if (!options.publisher) assertTransportConfigured(environment);
  const publisher = options.publisher ?? resolveOutboxPublisher(environment);

  const summary: OutboxRunnerSummary = {
    cycles: 0,
    claimed: 0,
    published: 0,
    failed: 0,
    deadLettered: 0,
    errors: 0,
    stoppedBy: "signal",
  };

  while (!options.signal?.aborted) {
    if (options.maxCycles !== undefined && summary.cycles >= options.maxCycles) {
      summary.stoppedBy = "max-cycles";
      return summary;
    }

    let waitMs = intervalMs;

    try {
      const result = await dispatchOutboxOnce({
        batchSize: options.batchSize,
        tenantId: options.tenantId,
        publisher,
      });
      summary.claimed += result.claimed;
      summary.published += result.published;
      summary.failed += result.failed;
      summary.deadLettered += result.deadLettered;
      options.onCycle?.(result, summary.cycles + 1);
    } catch (err) {
      summary.errors += 1;
      waitMs = errorBackoffMs;
      // Sanitised: a connection failure's message is exactly where a connection string
      // would appear, and this runs unattended where nobody is watching the console.
      logError("outbox runner: dispatch pass failed", err, { cycle: summary.cycles + 1 });
    }

    summary.cycles += 1;

    const isLastCycle = options.maxCycles !== undefined && summary.cycles >= options.maxCycles;
    if (!isLastCycle && !options.signal?.aborted) {
      await sleep(waitMs, options.signal);
    }
  }

  summary.stoppedBy =
    options.maxCycles !== undefined && summary.cycles >= options.maxCycles
      ? "max-cycles"
      : "signal";
  return summary;
}

/** One structured startup line, so the operational truth is in the log, not in folklore. */
export function describeRunnerStartup(transport: OutboxTransportDescription): string {
  return JSON.stringify({
    level: "info",
    scope: "outbox runner: starting",
    transport: transport.kind,
    deliversForReal: transport.deliversForReal,
    reason: sanitizeText(transport.reason),
  });
}
