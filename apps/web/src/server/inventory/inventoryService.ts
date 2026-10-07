import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAuditLog } from "@/server/identity/audit";
import { enqueueOutboxEvent } from "@/server/events/outbox";
import { canManageInventory } from "@/server/inventory/inventoryRoles";
import {
  applyStockMovement,
  movementKey,
  validateMovementQuantity,
  type MovementQuantityError,
} from "@/server/inventory/stockLedger";

/**
 * The operations a person can perform on stock: receive it, correct it, count it.
 *
 * What this is NOT, deliberately: purchasing. There is no supplier, purchase order or GRN
 * anywhere in the system, and inventing one here to make a receipt look official would be
 * building the procurement phase early and badly. A receipt here is exactly what it says — an
 * authorised, audited, attributed increase — and when procurement arrives it will supply
 * `referenceType`/`referenceId` rather than replace this.
 *
 * Every operation follows the same five steps in this order, and the order is the security
 * model:
 *
 *   1. resolve the actor and their tenant from the session (never from the request body)
 *   2. resolve the store and the variant *scoped to that tenant*
 *   3. check the role
 *   4. validate the quantity
 *   5. apply the movement inside a transaction
 *
 * Step 2 is what makes a cross-tenant reference impossible to construct: a foreign store id
 * and a nonexistent one produce the identical `not_found`, so the API cannot be used to
 * discover whether another tenant's store exists.
 */

export interface InventoryActor {
  tenantId: string;
  userId: string;
  tenantRole: "OWNER" | "STAFF";
}

export type InventoryFailure =
  | { status: "forbidden" }
  | { status: "not_found"; what: "store" | "variant" }
  | { status: "invalid_quantity"; reason: MovementQuantityError }
  | { status: "validation_error"; reason: string };

export type InventoryResult =
  | {
      status: "ok";
      movementId: string;
      balanceAfter: number;
      /** True when the request key had already been applied and nothing new was written. */
      duplicate: boolean;
    }
  | InventoryFailure;

interface ResolvedTarget {
  storeId: string;
  variantId: string;
  membershipRole: string | null;
}

/**
 * Resolve and authorise the (store, variant) pair a movement will touch.
 *
 * Both lookups are tenant-scoped. The membership lookup is by (user, store) — the composite
 * foreign keys on `store_memberships` guarantee a membership row cannot belong to a different
 * tenant than the store it names, so this cannot smuggle in foreign authority.
 */
async function resolveTarget(
  actor: InventoryActor,
  storeId: string,
  variantId: string,
): Promise<ResolvedTarget | InventoryFailure> {
  const store = await db.store.findFirst({
    where: { id: storeId, tenantId: actor.tenantId },
    select: { id: true },
  });
  if (!store) return { status: "not_found", what: "store" };

  const variant = await db.productVariant.findFirst({
    where: { id: variantId, tenantId: actor.tenantId },
    select: { id: true },
  });
  if (!variant) return { status: "not_found", what: "variant" };

  const membership = await db.storeMembership.findUnique({
    where: { userId_storeId: { userId: actor.userId, storeId: store.id } },
    select: { role: true },
  });

  if (
    !canManageInventory({ tenantRole: actor.tenantRole, membershipRole: membership?.role ?? null })
  ) {
    return { status: "forbidden" };
  }

  return { storeId: store.id, variantId: variant.id, membershipRole: membership?.role ?? null };
}

/** A prior application of the same request key, if there was one. */
async function findExistingMovement(tenantId: string, idempotencyKey: string) {
  return db.stockMovement.findUnique({
    where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
    select: { id: true, balanceAfter: true },
  });
}

/**
 * Shared tail of all three operations: replay-safe apply, then audit.
 *
 * Idempotency is checked twice on purpose — once before the transaction as a fast path, and
 * once by the unique index inside it. The pre-check keeps an ordinary retry cheap; the index
 * is what actually guarantees correctness when two retries race, because only one of them can
 * insert. The P2002 catch turns that race into the same successful "duplicate" answer the fast
 * path gives, so a client cannot tell which of its identical requests won.
 */
async function applyAudited(params: {
  actor: InventoryActor;
  target: ResolvedTarget;
  type: "RECEIPT" | "ADJUSTMENT" | "STOCK_TAKE";
  quantityDelta: number;
  reason: string | null;
  idempotencyKey: string;
  correlationId: string;
  auditAction: string;
  auditMetadata: Record<string, unknown>;
}): Promise<InventoryResult> {
  const existing = await findExistingMovement(params.actor.tenantId, params.idempotencyKey);
  if (existing) {
    return {
      status: "ok",
      movementId: existing.id,
      balanceAfter: existing.balanceAfter,
      duplicate: true,
    };
  }

  let applied;
  try {
    applied = await db.$transaction(async (tx) => {
      const movement = await applyStockMovement(tx, {
        tenantId: params.actor.tenantId,
        storeId: params.target.storeId,
        variantId: params.target.variantId,
        type: params.type,
        quantityDelta: params.quantityDelta,
        reason: params.reason,
        actorUserId: params.actor.userId,
        idempotencyKey: params.idempotencyKey,
      });

      await enqueueOutboxEvent(tx, {
        tenantId: params.actor.tenantId,
        storeId: params.target.storeId,
        eventType: "StockMovementCreated",
        entityId: movement.movementId,
        causationId: params.idempotencyKey,
        correlationId: params.correlationId,
        actorUserId: params.actor.userId,
        payload: { movementId: movement.movementId },
      });

      return movement;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const raced = await findExistingMovement(params.actor.tenantId, params.idempotencyKey);
      if (raced) {
        return {
          status: "ok",
          movementId: raced.id,
          balanceAfter: raced.balanceAfter,
          duplicate: true,
        };
      }
    }
    throw err;
  }

  // Outside the transaction, matching every other audited operation in this codebase: the
  // audit trail must survive even if a later step fails, and it is not part of the fact being
  // recorded. No outbox event is emitted — `StockChanged`/`StockAdjusted` are PLANNED in
  // EVENTS.md with no producer and no consumer, and emitting an event nothing reads would be
  // starting the event phase early.
  await writeAuditLog({
    tenantId: params.actor.tenantId,
    userId: params.actor.userId,
    action: params.auditAction,
    correlationId: params.correlationId,
    metadata: {
      ...params.auditMetadata,
      storeId: params.target.storeId,
      variantId: params.target.variantId,
      quantityDelta: params.quantityDelta,
      balanceAfter: applied.balanceAfter,
      movementId: applied.movementId,
    },
  });

  return {
    status: "ok",
    movementId: applied.movementId,
    balanceAfter: applied.balanceAfter,
    duplicate: false,
  };
}

export interface ReceiveStockInput {
  actor: InventoryActor;
  storeId: string;
  variantId: string;
  /** Positive. A receipt that removes stock is an adjustment, and must say so. */
  quantity: number;
  reason?: string | null;
  /** Client-supplied request key, so a double-submit does not receive the goods twice. */
  requestKey: string;
  correlationId: string;
}

/** Goods arriving. The operation that makes stock able to rise at all. */
export async function receiveStock(input: ReceiveStockInput): Promise<InventoryResult> {
  const invalid = validateMovementQuantity(input.quantity);
  if (invalid) return { status: "invalid_quantity", reason: invalid };
  if (input.quantity < 0) {
    return { status: "validation_error", reason: "A receipt must increase stock." };
  }

  const target = await resolveTarget(input.actor, input.storeId, input.variantId);
  if ("status" in target) return target;

  return applyAudited({
    actor: input.actor,
    target,
    type: "RECEIPT",
    quantityDelta: input.quantity,
    reason: input.reason?.trim() || null,
    idempotencyKey: movementKey.receipt(input.requestKey),
    correlationId: input.correlationId,
    auditAction: "StockReceived",
    auditMetadata: { requestKey: input.requestKey },
  });
}

export interface AdjustStockInput {
  actor: InventoryActor;
  storeId: string;
  variantId: string;
  /** Signed. Negative writes stock off; positive corrects an undercount. */
  quantityDelta: number;
  /** Required. An unexplained correction is indistinguishable from a mistake. */
  reason: string;
  requestKey: string;
  correlationId: string;
}

/** A correction with a stated reason: damage, shrinkage, a data-entry error. */
export async function adjustStock(input: AdjustStockInput): Promise<InventoryResult> {
  const invalid = validateMovementQuantity(input.quantityDelta);
  if (invalid) return { status: "invalid_quantity", reason: invalid };

  const reason = input.reason?.trim() ?? "";
  if (reason.length < 3) {
    return { status: "validation_error", reason: "Say why the stock is being adjusted." };
  }

  const target = await resolveTarget(input.actor, input.storeId, input.variantId);
  if ("status" in target) return target;

  return applyAudited({
    actor: input.actor,
    target,
    type: "ADJUSTMENT",
    quantityDelta: input.quantityDelta,
    reason,
    idempotencyKey: movementKey.adjustment(input.requestKey),
    correlationId: input.correlationId,
    auditAction: "StockAdjusted",
    auditMetadata: { requestKey: input.requestKey, reason },
  });
}

export interface StockTakeInput {
  actor: InventoryActor;
  storeId: string;
  variantId: string;
  /** What was physically counted on the shelf. Never negative. */
  countedQuantity: number;
  reason?: string | null;
  requestKey: string;
  correlationId: string;
}

export type StockTakeResult =
  | {
      status: "ok";
      movementId: string | null;
      balanceAfter: number;
      duplicate: boolean;
      delta: number;
    }
  | InventoryFailure;

/**
 * Record a physical count.
 *
 * The caller states what is on the shelf; the service works out the delta and records that.
 * Asking for the delta instead would make the operator do arithmetic against a number they
 * cannot see, which is how counts get entered backwards.
 *
 * A count that matches the system writes **no movement**: there is nothing to record, and a
 * zero-delta row would bury real corrections in noise. That is reported as `delta: 0` with a
 * null movement id rather than pretending something happened.
 */
export async function recordStockTake(input: StockTakeInput): Promise<StockTakeResult> {
  if (!Number.isInteger(input.countedQuantity) || input.countedQuantity < 0) {
    return { status: "validation_error", reason: "Enter the counted quantity as a whole number." };
  }

  const target = await resolveTarget(input.actor, input.storeId, input.variantId);
  if ("status" in target) return target;

  const idempotencyKey = movementKey.stockTake(input.requestKey);
  const existing = await findExistingMovement(input.actor.tenantId, idempotencyKey);
  if (existing) {
    return {
      status: "ok",
      movementId: existing.id,
      balanceAfter: existing.balanceAfter,
      duplicate: true,
      delta: 0,
    };
  }

  const level = await db.stockLevel.findUnique({
    where: { storeId_variantId: { storeId: target.storeId, variantId: target.variantId } },
    select: { quantity: true },
  });
  const recorded = level?.quantity ?? 0;
  const delta = input.countedQuantity - recorded;

  if (delta === 0) {
    return { status: "ok", movementId: null, balanceAfter: recorded, duplicate: false, delta: 0 };
  }

  const applied = await applyAudited({
    actor: input.actor,
    target,
    type: "STOCK_TAKE",
    quantityDelta: delta,
    reason: input.reason?.trim() || `Physical count: ${input.countedQuantity}`,
    idempotencyKey,
    correlationId: input.correlationId,
    auditAction: "StockTakeRecorded",
    auditMetadata: {
      requestKey: input.requestKey,
      countedQuantity: input.countedQuantity,
      recordedQuantity: recorded,
    },
  });

  if (applied.status !== "ok") return applied;
  return { ...applied, delta };
}

export interface StockMovementRow {
  id: string;
  type: string;
  quantityDelta: number;
  balanceAfter: number;
  reason: string | null;
  referenceType: string | null;
  referenceId: string | null;
  actorUserId: string | null;
  occurredAt: Date;
}

/**
 * The ledger for one variant at one store, newest first.
 *
 * Tenant-scoped like every other read here. It exists so a balance can be explained and
 * reconciled; no screen consumes it in this phase.
 */
export async function listStockMovements(params: {
  tenantId: string;
  storeId: string;
  variantId: string;
  limit?: number;
}): Promise<StockMovementRow[]> {
  return db.stockMovement.findMany({
    where: { tenantId: params.tenantId, storeId: params.storeId, variantId: params.variantId },
    orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
    take: Math.min(Math.max(params.limit ?? 50, 1), 200),
    select: {
      id: true,
      type: true,
      quantityDelta: true,
      balanceAfter: true,
      reason: true,
      referenceType: true,
      referenceId: true,
      actorUserId: true,
      occurredAt: true,
    },
  });
}
