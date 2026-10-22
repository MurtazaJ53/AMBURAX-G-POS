import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAuditLogTx } from "@/server/identity/audit";

/**
 * Stock reservations (screen 36, owner 2026-10-14).
 *
 * - Held POS bills never reserve.
 * - A confirmed order reserves what it still has to deliver, all lines or none, with a review date
 *   7 days out. It is never released by a timer: a manager renews or releases it, with a reason.
 * - An online checkout holds stock for 15 minutes; an expired hold simply stops counting.
 * - Reserving is atomic per store + variant: the stock-level row is locked, and stock is reservable
 *   only above what is already actively reserved. Idempotent by key.
 */

export const CHECKOUT_HOLD_MS = 15 * 60_000;
export const ORDER_REVIEW_MS = 7 * 86_400_000;

type Client = Prisma.TransactionClient;

/** Units actively reserved for one store + variant right now (expired checkout holds excluded). */
export async function activeReserved(
  client: Client | typeof db,
  tenantId: string,
  storeId: string,
  variantId: string,
  now = new Date(),
) {
  const rows = await client.$queryRaw<{ q: bigint | null }[]>`
    SELECT SUM("quantity") AS "q" FROM "stock_reservations"
     WHERE "tenantId" = ${tenantId} AND "storeId" = ${storeId} AND "variantId" = ${variantId}
       AND "status" = 'ACTIVE' AND ("expiresAt" IS NULL OR "expiresAt" > ${now})
  `;
  return Number(rows[0]?.q ?? 0);
}

/** Lock the stock-level row so reservations and sales of this variant here are serialised. */
async function lockLevel(tx: Client, tenantId: string, storeId: string, variantId: string): Promise<number> {
  const rows = await tx.$queryRaw<{ quantity: number }[]>`
    SELECT "quantity" FROM "stock_levels"
     WHERE "tenantId" = ${tenantId} AND "storeId" = ${storeId} AND "variantId" = ${variantId}
     FOR UPDATE
  `;
  return rows[0]?.quantity ?? 0;
}

export class ReservationShortError extends Error {
  constructor(
    public variantId: string,
    public available: number,
  ) {
    super(`Only ${available} available to reserve`);
  }
}

/**
 * Reserve lines inside the caller's transaction, all or none. Throws ReservationShortError when a
 * line can't be covered, which rolls the caller back.
 */
export async function reserveLines(
  tx: Client,
  input: {
    tenantId: string;
    storeId: string;
    source: "ORDER" | "CHECKOUT";
    sourceId: string;
    lines: { variantId: string; quantity: number }[];
    actorUserId: string;
    keyPrefix: string;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  // Lock in a stable order so two reservations can't deadlock on the same variants.
  const lines = [...input.lines].filter((l) => l.quantity > 0).sort((a, b) => a.variantId.localeCompare(b.variantId));
  for (const line of lines) {
    const onHand = await lockLevel(tx, input.tenantId, input.storeId, line.variantId);
    const reserved = await activeReserved(tx, input.tenantId, input.storeId, line.variantId, now);
    const available = Math.max(0, onHand - reserved);
    if (line.quantity > available) throw new ReservationShortError(line.variantId, available);
    await tx.stockReservation.create({
      data: {
        tenantId: input.tenantId,
        storeId: input.storeId,
        variantId: line.variantId,
        quantity: line.quantity,
        source: input.source,
        sourceId: input.sourceId,
        expiresAt: input.source === "CHECKOUT" ? new Date(now.getTime() + CHECKOUT_HOLD_MS) : null,
        reviewAt: input.source === "ORDER" ? new Date(now.getTime() + ORDER_REVIEW_MS) : null,
        idempotencyKey: `${input.keyPrefix}:${line.variantId}`,
        createdByUserId: input.actorUserId,
      },
    });
  }
}

/** Release every active reservation of a source (order cancelled, checkout abandoned or paid). */
export async function releaseSource(
  tx: Client,
  input: { tenantId: string; source: "ORDER" | "CHECKOUT"; sourceId: string; reason: string; consumed?: boolean },
) {
  const res = await tx.stockReservation.updateMany({
    where: { tenantId: input.tenantId, source: input.source, sourceId: input.sourceId, status: "ACTIVE" },
    data: { status: input.consumed ? "CONSUMED" : "RELEASED", releasedAt: new Date(), releaseReason: input.reason.slice(0, 200) },
  });
  return res.count;
}

/**
 * Units of an order delivered: its reservation for that variant shrinks by the delivered quantity
 * (and is marked consumed when nothing is left).
 */
export async function consumeForOrder(tx: Client, input: { tenantId: string; orderId: string; variantId: string; quantity: number }) {
  let left = input.quantity;
  const active = await tx.stockReservation.findMany({
    where: { tenantId: input.tenantId, source: "ORDER", sourceId: input.orderId, variantId: input.variantId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
  for (const r of active) {
    if (left <= 0) break;
    const take = Math.min(left, r.quantity);
    left -= take;
    if (take === r.quantity) {
      await tx.stockReservation.update({
        where: { id: r.id },
        data: { status: "CONSUMED", releasedAt: new Date(), releaseReason: "Delivered" },
      });
    } else {
      await tx.stockReservation.update({ where: { id: r.id }, data: { quantity: r.quantity - take } });
    }
  }
}

/** A checkout's 15-minute hold (online orders). Expired holds stop counting without any job. */
export async function holdForCheckout(input: {
  tenantId: string;
  storeId: string;
  checkoutId: string;
  lines: { variantId: string; quantity: number }[];
  actorUserId: string;
  now?: Date;
}): Promise<{ status: "ok"; expiresAt: Date } | { status: "short"; variantId: string; available: number }> {
  const now = input.now ?? new Date();
  try {
    await db.$transaction(async (tx) => {
      await reserveLines(tx, {
        tenantId: input.tenantId,
        storeId: input.storeId,
        source: "CHECKOUT",
        sourceId: input.checkoutId,
        lines: input.lines,
        actorUserId: input.actorUserId,
        keyPrefix: `checkout:${input.checkoutId}:${now.getTime()}`,
        now,
      });
    });
  } catch (err) {
    if (err instanceof ReservationShortError) return { status: "short", variantId: err.variantId, available: err.available };
    throw err;
  }
  return { status: "ok", expiresAt: new Date(now.getTime() + CHECKOUT_HOLD_MS) };
}

/**
 * POS check: a sale may not take units reserved for someone else. Called inside the sale's
 * transaction before the stock goes down; does nothing where no reservation exists.
 */
export async function assertSellable(tx: Client, input: { tenantId: string; storeId: string; variantId: string; quantity: number }) {
  const reserved = await activeReserved(tx, input.tenantId, input.storeId, input.variantId);
  if (reserved === 0) return;
  const onHand = await lockLevel(tx, input.tenantId, input.storeId, input.variantId);
  if (onHand - input.quantity < reserved) throw new ReservationShortError(input.variantId, Math.max(0, onHand - reserved));
}

type Actor = { tenantId: string; userId: string; tenantRole: "OWNER" | "STAFF" };

async function isManager(actor: Actor, storeId: string) {
  if (actor.tenantRole === "OWNER") return true;
  const m = await db.storeMembership.findFirst({
    where: { tenantId: actor.tenantId, userId: actor.userId, storeId },
    select: { role: true },
  });
  return m?.role === "STORE_MANAGER" || m?.role === "INVENTORY_MANAGER";
}

/** Renew (another 7 days) or release one order reservation — a person's decision, with a reason. */
export async function reviewReservation(input: {
  actor: Actor;
  reservationId: string;
  decision: "RENEW" | "RELEASE";
  reason: string;
}): Promise<{ status: "ok" } | { status: "not_found" } | { status: "forbidden" } | { status: "validation_error"; reason: string }> {
  const reason = input.reason.trim().replace(/\s+/g, " ");
  if (reason.length < 3 || reason.length > 200) return { status: "validation_error", reason: "Give a reason." };
  const r = await db.stockReservation.findFirst({ where: { id: input.reservationId, tenantId: input.actor.tenantId, status: "ACTIVE" } });
  if (!r) return { status: "not_found" };
  if (!(await isManager(input.actor, r.storeId))) return { status: "forbidden" };
  await db.$transaction(async (tx) => {
    if (input.decision === "RENEW") {
      await tx.stockReservation.update({ where: { id: r.id }, data: { reviewAt: new Date(Date.now() + ORDER_REVIEW_MS) } });
    } else {
      await tx.stockReservation.update({
        where: { id: r.id },
        data: { status: "RELEASED", releasedAt: new Date(), releaseReason: reason },
      });
    }
    await writeAuditLogTx(tx, {
      tenantId: input.actor.tenantId,
      userId: input.actor.userId,
      action: input.decision === "RENEW" ? "ReservationRenewed" : "ReservationReleased",
      correlationId: randomUUID(),
      metadata: { reservationId: r.id, source: r.source, sourceId: r.sourceId, reason },
    });
  });
  return { status: "ok" };
}

export async function listReservations(params: { tenantId: string; storeId: string; now?: Date }) {
  const now = params.now ?? new Date();
  const rows = await db.stockReservation.findMany({
    where: {
      tenantId: params.tenantId,
      storeId: params.storeId,
      status: "ACTIVE",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: [{ reviewAt: "asc" }, { createdAt: "asc" }],
    take: 300,
  });
  const variants = await db.productVariant.findMany({
    where: { tenantId: params.tenantId, id: { in: [...new Set(rows.map((r) => r.variantId))] } },
    select: { id: true, sku: true, product: { select: { name: true } } },
  });
  const orders = await db.order.findMany({
    where: { tenantId: params.tenantId, id: { in: rows.filter((r) => r.source === "ORDER").map((r) => r.sourceId) } },
    select: { id: true, orderNumber: true },
  });
  const vById = new Map(variants.map((v) => [v.id, v]));
  const oById = new Map(orders.map((o) => [o.id, o.orderNumber]));
  return rows.map((r) => ({
    ...r,
    sku: vById.get(r.variantId)?.sku ?? r.variantId,
    name: vById.get(r.variantId)?.product.name ?? "",
    orderNumber: r.source === "ORDER" ? (oById.get(r.sourceId) ?? null) : null,
    reviewDue: r.reviewAt !== null && r.reviewAt <= now,
  }));
}
