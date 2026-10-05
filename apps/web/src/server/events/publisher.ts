import type { OutboxEventType } from "@/server/events/outbox";

/**
 * The delivery boundary for outbox events.
 *
 * **No message bus exists in this system.** There is no Kafka, no RabbitMQ, no SNS, no
 * webhook dispatcher, and no consumer of any kind. Rather than pretend otherwise, delivery
 * goes through this interface and the shipped implementation logs and reports success —
 * the same disclosed stand-in pattern as `identity/notifier.ts` (ADR-024/028), where the
 * real logic is fully implemented and only the delivery leg is a placeholder.
 *
 * What IS real here: the durability. Events are committed atomically with their business
 * mutation, claimed with row-level locking, retried with backoff, and dead-lettered. Swap
 * this one interface for a real transport and nothing else changes.
 *
 * Be precise about what "published" means today: the local stand-in accepted the event. It
 * does not mean anything downstream received or acted on it, because nothing downstream
 * exists.
 */

/** The wire envelope. EVENTS.md's "Event requirements" list, as delivered to a consumer. */
export interface PublishableEvent {
  eventId: string;
  eventType: OutboxEventType | string;
  eventVersion: number;
  occurredAt: Date;
  tenantId: string;
  storeId: string | null;
  actorUserId: string | null;
  correlationId: string;
  causationId: string | null;
  entityId: string | null;
  payload: unknown;
}

export interface OutboxPublisher {
  /**
   * Deliver one event. Resolve on success; throw on failure.
   *
   * A throw is not a bug — it is the retry signal. The dispatcher records the error,
   * applies backoff, and re-attempts until the attempt ceiling, so a transport that is
   * temporarily down costs nothing but latency.
   */
  publish(event: PublishableEvent): Promise<void>;
}

/**
 * Raised when something tries to deliver an event and no transport is configured.
 *
 * This exists because the previous implementation did the opposite. `ConsoleOutboxPublisher`
 * used to `return` early under `NODE_ENV === "production"` and resolve successfully, so the
 * dispatcher stamped `publishedAt` on an event that had gone precisely nowhere. The database
 * then held a confident record of a delivery that never happened — the one thing an outbox
 * exists to prevent (audit finding F-01/F-04).
 *
 * A distinct, named error rather than a generic one: the runner checks for this condition at
 * startup and refuses to run, and an operator reading `lastError` should see a configuration
 * problem, not a transport outage.
 */
export class NoEventTransportConfiguredError extends Error {
  readonly code = "NO_EVENT_TRANSPORT_CONFIGURED";

  constructor() {
    super(
      "No outbox event transport is configured. Set OUTBOX_TRANSPORT=console for local " +
        "development, or configure a real transport. Events remain PENDING until one exists.",
    );
    this.name = "NoEventTransportConfiguredError";
  }
}

/**
 * The default when nothing is configured: fail, loudly and always.
 *
 * Throwing is what keeps the database honest. The dispatcher treats a throw as the retry
 * signal, so an event touched by this publisher stays unpublished with a readable
 * `lastError` — it is never mistaken for delivered. In practice the runner refuses to start
 * when this is the resolved transport, so events are not claimed at all; this class is the
 * second line of defence for any caller that bypasses the runner.
 */
export class UnconfiguredOutboxPublisher implements OutboxPublisher {
  async publish(): Promise<void> {
    throw new NoEventTransportConfiguredError();
  }
}

/**
 * Development stand-in. Writes a single structured line and reports success.
 *
 * Payloads must never contain secrets (enforced by convention at every producer), so this is
 * safe to print — but it must now be selected deliberately with OUTBOX_TRANSPORT=console,
 * and `resolveOutboxPublisher` refuses to hand it back in production. "Accepted by a local
 * log line" is a truthful claim only in development.
 */
export class ConsoleOutboxPublisher implements OutboxPublisher {
  async publish(event: PublishableEvent): Promise<void> {
    console.log(
      JSON.stringify({
        level: "info",
        scope: "outbox: accepted by dev stand-in - no real transport is connected",
        eventId: event.eventId,
        eventType: event.eventType,
        tenantId: event.tenantId,
        correlationId: event.correlationId,
      }),
    );
  }
}

/** What this process would actually do with an event right now. */
export interface OutboxTransportDescription {
  kind: "console" | "none" | "erpnext";
  /** True only when a consumer outside this process could genuinely receive the event. */
  deliversForReal: boolean;
  reason: string;
}

/**
 * Describe the configured transport without constructing anything.
 *
 * The runner logs this at startup and refuses to claim events when `kind` is "none", so the
 * operational state is stated out loud rather than inferred from an empty table.
 */
export function describeOutboxTransport(
  environment: NodeJS.ProcessEnv = process.env,
): OutboxTransportDescription {
  const configured = (environment.OUTBOX_TRANSPORT ?? "").trim().toLowerCase();
  const isProduction = environment.NODE_ENV === "production";

  if (configured === "console") {
    if (isProduction) {
      return {
        kind: "none",
        deliversForReal: false,
        reason: "OUTBOX_TRANSPORT=console is a development stand-in and is refused in production.",
      };
    }
    return {
      kind: "console",
      deliversForReal: false,
      reason:
        "Development stand-in: events are logged locally and marked published. Nothing downstream receives them.",
    };
  }

  if (configured === "erpnext") {
    return {
      kind: "erpnext",
      deliversForReal: true,
      reason: "Events are pushed directly to the configured ERPNext API via ErpClient.",
    };
  }

  return {
    kind: "none",
    deliversForReal: false,
    reason:
      configured.length === 0 || configured === "none"
        ? "No transport configured. Events accumulate as PENDING and are never marked published."
        : `Unknown OUTBOX_TRANSPORT value "${configured}". Treated as no transport.`,
  };
}

import { ErpOutboxPublisher } from "@/server/erp/outboxPublisher";

/**
 * Resolve the publisher for this process.
 *
 * Read at call time rather than at module load, so a worker's environment and a test's
 * environment are both honoured without a module-cache reset. No real transport exists in
 * this codebase yet; when one arrives it becomes another branch here and nothing else
 * changes.
 */
export function resolveOutboxPublisher(
  environment: NodeJS.ProcessEnv = process.env,
): OutboxPublisher {
  const kind = describeOutboxTransport(environment).kind;
  if (kind === "erpnext") {
    return new ErpOutboxPublisher();
  }
  return kind === "console"
    ? new ConsoleOutboxPublisher()
    : new UnconfiguredOutboxPublisher();
}
