import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAuditLogTx } from "@/server/identity/audit";
import { enqueueOutboxEvent } from "@/server/events/outbox";
import { canManageInventory } from "@/server/inventory/inventoryRoles";
import { applyStockMovement, validateMovementQuantity } from "@/server/inventory/stockLedger";

/**
 * Stock transfers between two stores of one business (screens 28-29; EVENTS.md TransferCreated /
 * TransferReceived).
 *
 * - Send: stock leaves the source at once (TRANSFER_OUT), the transfer is IN_TRANSIT, and each
 *   line remembers the source's weighted average cost.
 * - Receive: the destination states what arrived per line (never more than was sent); that much
 *   enters the destination (TRANSFER_IN) at the carried cost. A shortfall is recorded, not added.
 * - Cancel: only while in transit, puts everything back into the source.
 *
 * Each step is one transaction with its ledger movements, one outbox event and an audit row; ERPNext
 * receives each step as a Material Transfer through its transit warehouse (ERPNext is master). Sending
 * needs inventory rights in the source store; receiving needs them in the destination.
 */

export const MAX_TRANSFER_LINES = 200;

type Actor = { tenantId: string; userId: string; tenantRole: "OWNER" | "STAFF" };

export async function hasInventoryRightsIn(actor: Actor, storeId: string): Promise<boolean> {
  if (actor.tenantRole === "OWNER") {
    return (await db.store.count({ where: { id: storeId, tenantId: actor.tenantId } })) === 1;
  }
  const membership = await db.storeMembership.findUnique({
    where: { userId_storeId: { userId: actor.userId, storeId } },
    select: { role: true, tenantId: true },
  });
  return (
    membership?.tenantId === actor.tenantId &&
    canManageInventory({ tenantRole: "STAFF", membershipRole: membership.role })
  );
}


export type SendTransferResult =
  | { status: "ok"; transferId: string; duplicate: boolean }
  | { status: "forbidden" }
  | { status: "unknown_sku"; sku: string }
  | { status: "validation_error"; reason: string };

export async function sendTransfer(input: {
  actor: Actor;
  fromStoreId: string;
  toStoreId: string;
  lines: { sku: string; quantity: number }[];
  note?: string | null;
  idempotencyKey: string;
  correlationId?: string;
}): Promise<SendTransferResult> {
  const { actor } = input;
  const existing = await db.stockTransfer.findUnique({
    where: { tenantId_idempotencyKey: { tenantId: actor.tenantId, idempotencyKey: input.idempotencyKey } },
    select: { id: true },
  });
  if (existing) return { status: "ok", transferId: existing.id, duplicate: true };

  if (input.fromStoreId === input.toStoreId) {
    return { status: "validation_error", reason: "Choose a different store to send to." };
  }
  const toStore = await db.store.findFirst({ where: { id: input.toStoreId, tenantId: actor.tenantId }, select: { id: true } });
  if (!toStore) return { status: "validation_error", reason: "Choose a store of this business to send to." };
  if (!(await hasInventoryRightsIn(actor, input.fromStoreId))) return { status: "forbidden" };

  if (input.lines.length === 0) return { status: "validation_error", reason: "Add at least one item." };
  if (input.lines.length > MAX_TRANSFER_LINES) {
    return { status: "validation_error", reason: `At most ${MAX_TRANSFER_LINES} lines.` };
  }
  for (const [i, l] of input.lines.entries()) {
    if (!l.sku?.trim()) return { status: "validation_error", reason: `Line ${i + 1}: enter a SKU.` };
    if (validateMovementQuantity(l.quantity) || l.quantity <= 0) {
      return { status: "validation_error", reason: `Line ${i + 1}: enter a whole quantity above zero.` };
    }
  }
  const skus = [...new Set(input.lines.map((l) => l.sku.trim()))];
  if (skus.length !== input.lines.length) return { status: "validation_error", reason: "Each SKU can appear once." };
  const variants = await db.productVariant.findMany({
    where: { tenantId: actor.tenantId, sku: { in: skus } },
    select: { id: true, sku: true },
  });
  const bySku = new Map(variants.map((v) => [v.sku, v.id]));
  for (const sku of skus) if (!bySku.has(sku)) return { status: "unknown_sku", sku };

  const correlationId = input.correlationId ?? randomUUID();
  const note = input.note?.trim() ? input.note.trim().slice(0, 300) : null;

  try {
    const transferId = await db.$transaction(async (tx) => {
      const levels = await tx.stockLevel.findMany({
        where: { storeId: input.fromStoreId, variantId: { in: [...bySku.values()] } },
        select: { variantId: true, avgCostMinor: true },
      });
      const costByVariant = new Map(levels.map((l) => [l.variantId, l.avgCostMinor]));
      const transfer = await tx.stockTransfer.create({
        data: {
          tenantId: actor.tenantId,
          fromStoreId: input.fromStoreId,
          toStoreId: input.toStoreId,
          note,
          createdByUserId: actor.userId,
          idempotencyKey: input.idempotencyKey,
        },
        select: { id: true },
      });
      for (const l of input.lines) {
        const variantId = bySku.get(l.sku.trim())!;
        const key = `TRANSFER_OUT:${transfer.id}:${variantId}`;
        const movement = await applyStockMovement(tx, {
          tenantId: actor.tenantId,
          storeId: input.fromStoreId,
          variantId,
          type: "TRANSFER_OUT",
          quantityDelta: -l.quantity,
          reason: "Stock transfer sent",
          referenceType: "STOCK_TRANSFER",
          referenceId: transfer.id,
          actorUserId: actor.userId,
          idempotencyKey: key,
        });
        await tx.stockTransferLine.create({
          data: {
            tenantId: actor.tenantId,
            transferId: transfer.id,
            variantId,
            quantity: l.quantity,
            unitCostMinor: costByVariant.get(variantId) ?? null,
          },
        });
      }
      // ERPNext-first: each step syncs as one Material Transfer through the transit warehouse.
      await enqueueOutboxEvent(tx, {
        tenantId: actor.tenantId,
        storeId: input.fromStoreId,
        eventType: "StockTransferSent",
        entityId: transfer.id,
        correlationId,
        actorUserId: actor.userId,
        payload: { transferId: transfer.id },
      });
      await writeAuditLogTx(tx, {
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: "TransferCreated",
        correlationId,
        metadata: { transferId: transfer.id, from: input.fromStoreId, to: input.toStoreId, lines: input.lines.length },
      });
      return transfer.id;
    });
    return { status: "ok", transferId, duplicate: false };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const raced = await db.stockTransfer.findUnique({
        where: { tenantId_idempotencyKey: { tenantId: actor.tenantId, idempotencyKey: input.idempotencyKey } },
        select: { id: true },
      });
      if (raced) return { status: "ok", transferId: raced.id, duplicate: true };
    }
    throw err;
  }
}

export type ReceiveTransferResult =
  | { status: "ok"; shortUnits: number }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "not_in_transit" }
  | { status: "validation_error"; reason: string };

/**
 * Receive a transfer. `received` maps line id -> units that arrived; a missing line means all of
 * it arrived. Claimed atomically: two people receiving at once cannot both add the stock.
 */
export async function receiveTransfer(input: {
  actor: Actor;
  transferId: string;
  received?: Record<string, number>;
  correlationId?: string;
}): Promise<ReceiveTransferResult> {
  const { actor } = input;
  const transfer = await db.stockTransfer.findFirst({
    where: { id: input.transferId, tenantId: actor.tenantId },
    select: {
      id: true,
      toStoreId: true,
      status: true,
      lines: { select: { id: true, variantId: true, quantity: true, unitCostMinor: true } },
    },
  });
  if (!transfer) return { status: "not_found" };
  if (!(await hasInventoryRightsIn(actor, transfer.toStoreId))) return { status: "forbidden" };
  if (transfer.status !== "IN_TRANSIT") return { status: "not_in_transit" };

  const arrived = new Map<string, number>();
  for (const line of transfer.lines) {
    const q = input.received?.[line.id] ?? line.quantity;
    if (!Number.isSafeInteger(q) || q < 0 || q > line.quantity) {
      return { status: "validation_error", reason: `Received quantity must be between 0 and ${line.quantity}.` };
    }
    arrived.set(line.id, q);
  }
  const correlationId = input.correlationId ?? randomUUID();

  return db.$transaction(async (tx) => {
    // The claim: only one receive can move IN_TRANSIT to RECEIVED.
    const claimed = await tx.stockTransfer.updateMany({
      where: { id: transfer.id, tenantId: actor.tenantId, status: "IN_TRANSIT" },
      data: { status: "RECEIVED", receivedAt: new Date(), receivedByUserId: actor.userId },
    });
    if (claimed.count === 0) return { status: "not_in_transit" } as const;

    let shortUnits = 0;
    for (const line of transfer.lines) {
      const q = arrived.get(line.id)!;
      shortUnits += line.quantity - q;
      await tx.stockTransferLine.update({ where: { id: line.id }, data: { receivedQuantity: q } });
      if (q === 0) continue;
      const key = `TRANSFER_IN:${transfer.id}:${line.variantId}`;
      const movement = await applyStockMovement(tx, {
        tenantId: actor.tenantId,
        storeId: transfer.toStoreId,
        variantId: line.variantId,
        type: "TRANSFER_IN",
        quantityDelta: q,
        reason: q < line.quantity ? `Stock transfer received (${line.quantity - q} short)` : "Stock transfer received",
        referenceType: "STOCK_TRANSFER",
        referenceId: transfer.id,
        actorUserId: actor.userId,
        unitCostMinor: line.unitCostMinor,
        idempotencyKey: key,
      });
    }
    // ERPNext-first: each step syncs as one Material Transfer through the transit warehouse.
    await enqueueOutboxEvent(tx, {
      tenantId: actor.tenantId,
      storeId: transfer.toStoreId,
      eventType: "StockTransferReceived",
      entityId: transfer.id,
      correlationId,
      actorUserId: actor.userId,
      payload: { transferId: transfer.id },
    });
    await writeAuditLogTx(tx, {
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: "TransferReceived",
      correlationId,
      metadata: { transferId: transfer.id, shortUnits },
    });
    return { status: "ok", shortUnits } as const;
  });
}

export type CancelTransferResult =
  | { status: "ok" }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "not_in_transit" };

/** Cancel a transfer still in transit; every unit goes back into the source store. */
export async function cancelTransfer(input: {
  actor: Actor;
  transferId: string;
  correlationId?: string;
}): Promise<CancelTransferResult> {
  const { actor } = input;
  const transfer = await db.stockTransfer.findFirst({
    where: { id: input.transferId, tenantId: actor.tenantId },
    select: {
      id: true,
      fromStoreId: true,
      status: true,
      lines: { select: { variantId: true, quantity: true, unitCostMinor: true } },
    },
  });
  if (!transfer) return { status: "not_found" };
  if (!(await hasInventoryRightsIn(actor, transfer.fromStoreId))) return { status: "forbidden" };
  if (transfer.status !== "IN_TRANSIT") return { status: "not_in_transit" };
  const correlationId = input.correlationId ?? randomUUID();

  return db.$transaction(async (tx) => {
    const claimed = await tx.stockTransfer.updateMany({
      where: { id: transfer.id, tenantId: actor.tenantId, status: "IN_TRANSIT" },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    if (claimed.count === 0) return { status: "not_in_transit" } as const;
    for (const line of transfer.lines) {
      const key = `TRANSFER_IN:cancel:${transfer.id}:${line.variantId}`;
      const movement = await applyStockMovement(tx, {
        tenantId: actor.tenantId,
        storeId: transfer.fromStoreId,
        variantId: line.variantId,
        type: "TRANSFER_IN",
        quantityDelta: line.quantity,
        reason: "Stock transfer cancelled — returned to this store",
        referenceType: "STOCK_TRANSFER",
        referenceId: transfer.id,
        actorUserId: actor.userId,
        unitCostMinor: line.unitCostMinor,
        idempotencyKey: key,
      });
    }
    // ERPNext-first: each step syncs as one Material Transfer through the transit warehouse.
    await enqueueOutboxEvent(tx, {
      tenantId: actor.tenantId,
      storeId: transfer.fromStoreId,
      eventType: "StockTransferCancelled",
      entityId: transfer.id,
      correlationId,
      actorUserId: actor.userId,
      payload: { transferId: transfer.id },
    });
    await writeAuditLogTx(tx, {
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: "TransferCancelled",
      correlationId,
      metadata: { transferId: transfer.id },
    });
    return { status: "ok" } as const;
  });
}

export async function listTransfers(params: { tenantId: string; storeId: string; limit?: number }) {
  return db.stockTransfer.findMany({
    where: { tenantId: params.tenantId, OR: [{ fromStoreId: params.storeId }, { toStoreId: params.storeId }] },
    orderBy: { createdAt: "desc" },
    take: params.limit ?? 50,
    select: {
      id: true,
      status: true,
      createdAt: true,
      receivedAt: true,
      fromStoreId: true,
      toStoreId: true,
      fromStore: { select: { name: true, code: true } },
      toStore: { select: { name: true, code: true } },
      lines: { select: { quantity: true, receivedQuantity: true } },
    },
  });
}

export async function getTransfer(params: { tenantId: string; transferId: string }) {
  return db.stockTransfer.findFirst({
    where: { id: params.transferId, tenantId: params.tenantId },
    select: {
      id: true,
      status: true,
      note: true,
      createdAt: true,
      receivedAt: true,
      cancelledAt: true,
      fromStoreId: true,
      toStoreId: true,
      fromStore: { select: { name: true, code: true } },
      toStore: { select: { name: true, code: true } },
      lines: {
        select: {
          id: true,
          quantity: true,
          receivedQuantity: true,
          unitCostMinor: true,
          variant: { select: { sku: true, size: true, colour: true, product: { select: { name: true } } } },
        },
      },
    },
  });
}
