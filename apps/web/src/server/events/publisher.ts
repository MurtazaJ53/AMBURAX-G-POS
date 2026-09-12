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
 * Development stand-in. Writes a single structured line and reports success.
 *
 * Payloads must never contain secrets (enforced by convention at every producer), so this
 * is safe to print — but it is gated to non-production anyway, because a real deployment
 * logging every domain event body is a data-volume and privacy problem regardless of
 * whether any single field is a credential.
 */
class ConsoleOutboxPublisher implements OutboxPublisher {
  async publish(event: PublishableEvent): Promise<void> {
    if (process.env.NODE_ENV === "production") return;
    console.log(
      JSON.stringify({
        level: "info",
        scope: "outbox: published (dev stand-in - no real transport is connected)",
        eventId: event.eventId,
        eventType: event.eventType,
        tenantId: event.tenantId,
        correlationId: event.correlationId,
      }),
    );
  }
}

export const outboxPublisher: OutboxPublisher = new ConsoleOutboxPublisher();
