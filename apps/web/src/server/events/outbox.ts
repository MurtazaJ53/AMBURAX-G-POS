import { Prisma } from "@prisma/client";

/**
 * The producer half of ADR-010's durable outbox. Closes audit finding P1-4.
 *
 * The single design rule, enforced by the type signature: `enqueueOutboxEvent` accepts a
 * `Prisma.TransactionClient` and nothing else. It cannot be called with the global `db`
 * client, so it is not possible to write an event outside the transaction that produced
 * the fact it describes. The event commits with the mutation or not at all.
 *
 * This is the difference between this table and `AuditLog`, which deliberately writes
 * outside the transaction (see schema.prisma). Both are kept; they answer different
 * questions.
 */

/**
 * Event types this system may emit. A closed union rather than a free string: a typo in an
 * event name is a silently undeliverable event, and consumers match on this value.
 *
 * Deliberately short. These are events the codebase can actually produce; the rest of
 * EVENTS.md's catalogue is added as each producer is built, not in advance.
 */
export const OUTBOX_EVENT_TYPES = [
  // EVENTS.md lists this under "Transaction events". Emitted by saleService inside the
  // sale transaction, so it exists if and only if the sale committed.
  "SaleCompleted",
  "PosDeviceCreated",
  "PosDeviceActivated",
  "PosDeviceDisabled",
  "InvitationAccepted",
  "OnboardingCompleted",
  "ProductVariantCreated",
  "ProductVariantUpdated",
  "StoreCreated",
  "StockMovementCreated",
] as const;

export type OutboxEventType = (typeof OUTBOX_EVENT_TYPES)[number];

export interface EnqueueOutboxEventInput {
  /** Required. An event that cannot be attributed to a tenant cannot be dispatched safely. */
  tenantId: string;
  storeId?: string | null;
  eventType: OutboxEventType;
  /** Bump when a payload's shape changes incompatibly; consumers branch on it. */
  eventVersion?: number;
  /** The user whose action produced this. Null for machine-originated events (device pairing). */
  actorUserId?: string | null;
  correlationId: string;
  /** The id of the event or request that caused this one, when there is one. */
  causationId?: string | null;
  /** The primary entity this event is about — the device id, invitation id, and so on. */
  entityId?: string | null;
  /**
   * Must contain no secrets. Pairing codes, device secrets, tokens and password hashes are
   * never event payload material — an outbox row is read by every future consumer and may
   * be replayed long after the credential it mentions was rotated.
   */
  payload: Record<string, unknown>;
  /**
   * Distinguishes repeated events about the same entity (e.g. a second pairing code for
   * one device). Omit when one event per (tenant, type, entity) is the correct semantics.
   */
  discriminator?: string;
}

/**
 * Deterministic producer-side deduplication key.
 *
 * Derived from the business fact rather than randomly generated, so a retried operation
 * that reaches the insert a second time collides on the unique index instead of enqueuing
 * a duplicate. Note this protects against duplicate *committed* enqueues only; a rolled
 * back transaction leaves no row, so a retry is free to insert — which is exactly right.
 */
export function outboxIdempotencyKey(input: {
  tenantId: string;
  eventType: string;
  entityId?: string | null;
  discriminator?: string;
}): string {
  return [input.tenantId, input.eventType, input.entityId ?? "-", input.discriminator ?? "-"].join(
    ":",
  );
}

/**
 * Enqueue one domain event inside the caller's transaction.
 *
 * Throws on a duplicate idempotency key (Prisma P2002) rather than swallowing it. That is
 * deliberate: silently ignoring the collision would hide a genuine double-emit bug, and
 * because this runs inside the caller's transaction, letting it throw aborts the business
 * mutation too. A caller that legitimately expects repeats must pass a `discriminator`.
 */
export async function enqueueOutboxEvent(
  tx: Prisma.TransactionClient,
  input: EnqueueOutboxEventInput,
): Promise<{ id: string; idempotencyKey: string }> {
  const idempotencyKey = outboxIdempotencyKey({
    tenantId: input.tenantId,
    eventType: input.eventType,
    entityId: input.entityId,
    discriminator: input.discriminator,
  });

  return tx.outboxEvent.create({
    data: {
      tenantId: input.tenantId,
      storeId: input.storeId ?? null,
      eventType: input.eventType,
      eventVersion: input.eventVersion ?? 1,
      actorUserId: input.actorUserId ?? null,
      correlationId: input.correlationId,
      causationId: input.causationId ?? null,
      entityId: input.entityId ?? null,
      payload: input.payload as Prisma.InputJsonValue,
      idempotencyKey,
    },
    select: { id: true, idempotencyKey: true },
  });
}

/** Delivery state, derived rather than stored — same convention as Invitation/PosDevice. */
export type OutboxEventStatus = "PENDING" | "PUBLISHED" | "DEAD_LETTERED";

export function deriveOutboxEventStatus(event: {
  publishedAt: Date | null;
  deadLetteredAt: Date | null;
}): OutboxEventStatus {
  if (event.publishedAt) return "PUBLISHED";
  if (event.deadLetteredAt) return "DEAD_LETTERED";
  return "PENDING";
}
