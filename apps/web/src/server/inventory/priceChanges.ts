import { Prisma } from "@prisma/client";
import { enqueueOutboxEvent } from "@/server/events/outbox";

/**
 * Restocking at a new selling price, and what happens to the stock already on the shelf.
 *
 * A variant has one selling price. When goods arrive at a different price there are only two
 * honest answers to "what do the units already on the shelf sell for", and the person
 * receiving the goods chooses between them:
 *
 *   - `now` — every unit, old and new, sells at the new price from this moment. Right when the
 *     older units have been re-tagged, or the price is going down.
 *   - `after_older_stock` — the older units keep selling at the price on their tags, and the
 *     new price takes over by itself the moment the last of them leaves stock. Right when the
 *     new delivery carries a higher MRP than the tags already on the shelf, which may never be
 *     charged above what is printed on them.
 *
 * The second is a queue, not a timer: each queued change remembers how many older units stood
 * in front of it (`unitsAhead`), and `consumeOlderStock` — called by the stock ledger for every
 * unit that leaves stock — counts them down. Several queued changes count down together, so
 * three deliveries at three prices switch in the order the shelf empties.
 *
 * Purchase cost is deliberately not handled here: it is recorded on the receipt movement and
 * valued by the ledger owner. This module is only about the selling price.
 */

export type PricePolicy = "now" | "after_older_stock";

export interface PriceChangeRequest {
  priceMinor: number;
  mrpMinor: number | null;
  policy: PricePolicy;
}

/** Upper bound on a price, in minor units: ₹1 crore. A typo guard, not a business rule. */
export const MAX_PRICE_MINOR = 1_000_000_000;

/** Null when the request is a valid price; otherwise a sentence a person can act on. */
export function validatePriceChange(request: PriceChangeRequest): string | null {
  const { priceMinor, mrpMinor } = request;
  if (!Number.isSafeInteger(priceMinor) || priceMinor <= 0 || priceMinor > MAX_PRICE_MINOR) {
    return "Enter a valid selling price.";
  }
  if (mrpMinor !== null) {
    if (!Number.isSafeInteger(mrpMinor) || mrpMinor <= 0 || mrpMinor > MAX_PRICE_MINOR) {
      return "Enter a valid MRP.";
    }
    if (priceMinor > mrpMinor) {
      return "The selling price cannot be higher than the MRP.";
    }
  }
  if (request.policy !== "now" && request.policy !== "after_older_stock") {
    return "Choose when the new price should apply.";
  }
  return null;
}

export type PriceChangeOutcome =
  | { outcome: "unchanged" }
  | { outcome: "applied"; priceMinor: number; mrpMinor: number | null }
  | { outcome: "queued"; changeId: string; unitsAhead: number };

/**
 * Apply or queue a new selling price for one variant, inside the caller's transaction.
 *
 * `olderUnits` is how many units were on hand, across every store, before the goods that carry
 * the new price arrived. When there are none, "sell older stock first" has nothing to wait for
 * and the price applies immediately.
 *
 * The variant row is locked first, so two receipts changing the same variant's price serialise
 * rather than each reading the old price and both believing they changed it.
 */
export async function applyOrQueuePriceChange(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    variantId: string;
    request: PriceChangeRequest;
    olderUnits: number;
    actorUserId: string | null;
    sourceMovementId: string | null;
    correlationId: string;
  },
): Promise<PriceChangeOutcome> {
  const locked = await tx.$queryRaw<{ priceMinor: number; mrpMinor: number | null }[]>`
    SELECT "priceMinor", "mrpMinor" FROM "product_variants"
    WHERE "id" = ${params.variantId} AND "tenantId" = ${params.tenantId}
    FOR UPDATE
  `;
  const current = locked[0];
  if (!current) throw new Error("price change: variant disappeared inside its own transaction");

  const { priceMinor, mrpMinor, policy } = params.request;
  if (current.priceMinor === priceMinor && current.mrpMinor === mrpMinor) {
    return { outcome: "unchanged" };
  }

  if (policy === "now" || params.olderUnits <= 0) {
    await setVariantPrice(tx, {
      tenantId: params.tenantId,
      variantId: params.variantId,
      priceMinor,
      mrpMinor,
      actorUserId: params.actorUserId,
      correlationId: params.correlationId,
      causationId: params.sourceMovementId,
      discriminator: `price:${params.sourceMovementId ?? params.correlationId}`,
    });
    // A price set for all stock overrides anything still waiting: those queued prices were
    // decided against a shelf this decision has just re-priced.
    await cancelPendingPriceChanges(tx, { tenantId: params.tenantId, variantId: params.variantId });
    return { outcome: "applied", priceMinor, mrpMinor };
  }

  const change = await tx.pendingPriceChange.create({
    data: {
      tenantId: params.tenantId,
      variantId: params.variantId,
      newPriceMinor: priceMinor,
      newMrpMinor: mrpMinor,
      previousPriceMinor: current.priceMinor,
      previousMrpMinor: current.mrpMinor,
      unitsAhead: params.olderUnits,
      sourceMovementId: params.sourceMovementId,
      actorUserId: params.actorUserId,
    },
    select: { id: true },
  });
  return { outcome: "queued", changeId: change.id, unitsAhead: params.olderUnits };
}

/**
 * Count units leaving stock against queued price changes for the variant.
 *
 * If `selectedBatch` is:
 * - "old" (or when price matches the older variant price):
 *   Decrements `unitsAhead`. When `unitsAhead <= 0`, older stock has fully cleared and
 *   the pending price change applies to become the master variant price.
 * - "new" (when customer buys the new price batch before older stock cleared):
 *   DOES NOT decrement `unitsAhead` (the older units are still on the shelf!).
 *   Checks if `newStockRemaining` has hit 0 (totalStock <= unitsAhead).
 *   If all new units sold out while old units remain on the shelf, cancels the pending change
 *   so the master shelf price doesn't erroneously switch when the remaining old units eventually sell.
 */
export async function consumeOlderStock(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    variantId: string;
    units: number;
    causationId: string;
    batchChoice?: "old" | "new";
  },
): Promise<void> {
  if (params.units <= 0) return;

  // If cashier selected the "new" batch:
  if (params.batchChoice === "new") {
    // 1. Do NOT decrement unitsAhead because older stock is still sitting on the shelf.
    // 2. Read total remaining stock across stores to check if new stock bucket is exhausted.
    const levels = await tx.stockLevel.findMany({
      where: { tenantId: params.tenantId, variantId: params.variantId },
      select: { quantity: true },
    });
    const totalRemaining = levels.reduce((sum, s) => sum + Math.max(0, s.quantity), 0);

    const pending = await tx.pendingPriceChange.findMany({
      where: { tenantId: params.tenantId, variantId: params.variantId, status: "PENDING" },
      select: { id: true, unitsAhead: true },
    });

    // If newStockRemaining (totalRemaining - unitsAhead) <= 0, new stock is completely sold out!
    // Cancel the pending price change so it doesn't auto-flip later.
    const exhaustedPendingIds = pending
      .filter((p) => totalRemaining <= p.unitsAhead)
      .map((p) => p.id);

    if (exhaustedPendingIds.length > 0) {
      await tx.pendingPriceChange.updateMany({
        where: { id: { in: exhaustedPendingIds }, tenantId: params.tenantId },
        data: { status: "CANCELLED" },
      });
    }
    return;
  }

  // If cashier selected "old" batch (or default countdown):
  const counted = await tx.$queryRaw<
    { id: string; unitsAhead: number; newPriceMinor: number; newMrpMinor: number | null; createdAt: Date }[]
  >`
    UPDATE "pending_price_changes"
       SET "unitsAhead" = "unitsAhead" - ${params.units}
     WHERE "tenantId" = ${params.tenantId}
       AND "variantId" = ${params.variantId}
       AND "status" = 'PENDING'
    RETURNING "id", "unitsAhead", "newPriceMinor", "newMrpMinor", "createdAt"
  `;

  const due = counted.filter((c) => c.unitsAhead <= 0);
  if (due.length === 0) return;

  // When one sale clears several queues at once, the newest price is the one on the shelf now.
  const winner = due.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));

  await setVariantPrice(tx, {
    tenantId: params.tenantId,
    variantId: params.variantId,
    priceMinor: winner.newPriceMinor,
    mrpMinor: winner.newMrpMinor,
    actorUserId: null,
    correlationId: winner.id,
    causationId: params.causationId,
    discriminator: `price-change:${winner.id}`,
  });

  await tx.pendingPriceChange.updateMany({
    where: { id: { in: due.map((d) => d.id) }, tenantId: params.tenantId },
    data: { status: "APPLIED", appliedAt: new Date() },
  });
}

/** Write the price and tell the ledger owner, in the same transaction. */
async function setVariantPrice(
  tx: Prisma.TransactionClient,
  params: {
    tenantId: string;
    variantId: string;
    priceMinor: number;
    mrpMinor: number | null;
    actorUserId: string | null;
    correlationId: string;
    causationId: string | null;
    discriminator: string;
  },
): Promise<void> {
  await tx.productVariant.update({
    where: { id: params.variantId, tenantId: params.tenantId },
    data: { priceMinor: params.priceMinor, mrpMinor: params.mrpMinor },
  });

  // The same event a price edit in the catalogue emits, so the Item's selling rate follows.
  await enqueueOutboxEvent(tx, {
    tenantId: params.tenantId,
    eventType: "ProductVariantUpdated",
    actorUserId: params.actorUserId,
    correlationId: params.correlationId,
    causationId: params.causationId,
    entityId: params.variantId,
    payload: { variantId: params.variantId },
    discriminator: params.discriminator,
  });
}

/** Cancel every queued change for a variant — a person has just set its price directly. */
export async function cancelPendingPriceChanges(
  tx: Prisma.TransactionClient,
  params: { tenantId: string; variantId: string },
): Promise<void> {
  await tx.pendingPriceChange.updateMany({
    where: { tenantId: params.tenantId, variantId: params.variantId, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
}
