import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAuditLogTx } from "@/server/identity/audit";
import { enqueueOutboxEvent } from "@/server/events/outbox";
import { canManageInventory } from "@/server/inventory/inventoryRoles";
import { MAX_PRICE_MINOR } from "@/server/inventory/priceChanges";

/**
 * Purchase orders (screens 47-48), ERPNext-first: an order syncs to ERPNext as a submitted
 * Purchase Order, and goods received against it (purchaseReceipts.ts) cite its lines so ERPNext
 * tracks what is still to come. Receiving more than was ordered is refused, matching ERPNext's
 * default over-receipt allowance of 0%.
 *
 * Status is OPEN or CANCELLED; "part received" and "received" are read off the lines.
 */

export const MAX_ORDER_LINES = 200;
const MAX_UNITS = 100_000;

type Actor = { tenantId: string; userId: string; tenantRole: "OWNER" | "STAFF"; membershipRole: string | null };

/** Today's date (YYYY-MM-DD) in India time: the earliest an order can be expected. */
export function todayInIndia(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

export type OrderProgress ="open" | "part_received" | "received" | "cancelled";

export function orderProgress(o: { status: string; lines: { quantity: number; receivedQuantity: number }[] }): OrderProgress {
  if (o.status === "CANCELLED") return "cancelled";
  const ordered = o.lines.reduce((s, l) => s + l.quantity, 0);
  const received = o.lines.reduce((s, l) => s + Math.min(l.receivedQuantity, l.quantity), 0);
  if (received === 0) return "open";
  return received >= ordered ? "received" : "part_received";
}

export interface OrderLineInput {
  sku: string;
  quantity: number;
  unitCostMinor: number;
  gstRateBp: number;
}

export type CreateOrderResult =
  | { status: "ok"; orderId: string; duplicate: boolean }
  | { status: "forbidden" }
  | { status: "not_found"; what: "store" | "supplier" }
  | { status: "unknown_sku"; sku: string }
  | { status: "validation_error"; reason: string };

export async function createPurchaseOrder(input: {
  actor: Actor;
  storeId: string;
  supplierId: string;
  expectedDate: Date | null;
  notes?: string | null;
  lines: OrderLineInput[];
  idempotencyKey: string;
  correlationId?: string;
  now?: Date;
}): Promise<CreateOrderResult> {
  const { actor } = input;
  if (!canManageInventory(actor)) return { status: "forbidden" };
  const existing = await db.purchaseOrder.findUnique({
    where: { tenantId_idempotencyKey: { tenantId: actor.tenantId, idempotencyKey: input.idempotencyKey } },
    select: { id: true },
  });
  if (existing) return { status: "ok", orderId: existing.id, duplicate: true };

  if (!input.expectedDate || Number.isNaN(input.expectedDate.getTime())) {
    return { status: "validation_error", reason: "Choose when you expect the goods." };
  }
  // Start of today in India time: an order due today is fine, one due yesterday is not.
  const nowIst = new Date((input.now ?? new Date()).getTime() + 330 * 60_000);
  const today = new Date(`${nowIst.toISOString().slice(0, 10)}T00:00:00+05:30`);
  if (input.expectedDate.getTime() < today.getTime()) {
    return { status: "validation_error", reason: "The expected date can't be in the past." };
  }
  if (input.lines.length === 0) return { status: "validation_error", reason: "Add at least one item." };
  if (input.lines.length > MAX_ORDER_LINES) return { status: "validation_error", reason: `At most ${MAX_ORDER_LINES} lines.` };
  for (const [i, l] of input.lines.entries()) {
    const n = i + 1;
    if (!l.sku?.trim()) return { status: "validation_error", reason: `Line ${n}: enter a SKU.` };
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > MAX_UNITS) {
      return { status: "validation_error", reason: `Line ${n}: enter a whole quantity above zero.` };
    }
    if (!Number.isSafeInteger(l.unitCostMinor) || l.unitCostMinor < 0 || l.unitCostMinor > MAX_PRICE_MINOR) {
      return { status: "validation_error", reason: `Line ${n}: enter a valid cost.` };
    }
    if (!Number.isSafeInteger(l.gstRateBp) || l.gstRateBp < 0 || l.gstRateBp > 10_000) {
      return { status: "validation_error", reason: `Line ${n}: choose a valid GST rate.` };
    }
  }
  const skus = input.lines.map((l) => l.sku.trim());
  if (new Set(skus).size !== skus.length) return { status: "validation_error", reason: "Each SKU can appear once." };

  const [store, supplier, variants] = await Promise.all([
    db.store.findFirst({ where: { id: input.storeId, tenantId: actor.tenantId }, select: { id: true } }),
    db.supplier.findFirst({ where: { id: input.supplierId, tenantId: actor.tenantId, isActive: true }, select: { id: true } }),
    db.productVariant.findMany({ where: { tenantId: actor.tenantId, sku: { in: skus } }, select: { id: true, sku: true } }),
  ]);
  if (!store) return { status: "not_found", what: "store" };
  if (!supplier) return { status: "not_found", what: "supplier" };
  const bySku = new Map(variants.map((v) => [v.sku, v.id]));
  for (const sku of skus) if (!bySku.has(sku)) return { status: "unknown_sku", sku };

  const taxableMinor = input.lines.reduce((s, l) => s + l.quantity * l.unitCostMinor, 0);
  if (taxableMinor > 2_147_483_647) return { status: "validation_error", reason: "This order is too large for one go." };
  const notes = input.notes?.trim().slice(0, 500) || null;
  const correlationId = input.correlationId ?? randomUUID();

  try {
    const orderId = await db.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.create({
        data: {
          tenantId: actor.tenantId,
          storeId: store.id,
          supplierId: supplier.id,
          expectedDate: input.expectedDate!,
          notes,
          taxableMinor,
          createdByUserId: actor.userId,
          idempotencyKey: input.idempotencyKey,
          lines: {
            create: input.lines.map((l) => ({
              variantId: bySku.get(l.sku.trim())!,
              quantity: l.quantity,
              unitCostMinor: l.unitCostMinor,
              gstRateBp: l.gstRateBp,
            })),
          },
        },
        select: { id: true },
      });
      await enqueueOutboxEvent(tx, {
        tenantId: actor.tenantId,
        storeId: store.id,
        eventType: "PurchaseOrderCreated",
        entityId: order.id,
        correlationId,
        actorUserId: actor.userId,
        payload: { orderId: order.id },
      });
      await writeAuditLogTx(tx, {
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: "PurchaseOrderCreated",
        correlationId,
        metadata: { orderId: order.id, supplierId: supplier.id, lines: input.lines.length, taxableMinor },
      });
      return order.id;
    });
    return { status: "ok", orderId, duplicate: false };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const raced = await db.purchaseOrder.findUnique({
        where: { tenantId_idempotencyKey: { tenantId: actor.tenantId, idempotencyKey: input.idempotencyKey } },
        select: { id: true },
      });
      if (raced) return { status: "ok", orderId: raced.id, duplicate: true };
    }
    throw err;
  }
}

export type CancelOrderResult =
  | { status: "ok" }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "conflict"; reason: string };

/** Cancel an order nothing has been received against. Part-received orders stay open. */
export async function cancelPurchaseOrder(input: { actor: Actor; orderId: string; correlationId?: string }): Promise<CancelOrderResult> {
  const { actor } = input;
  if (!canManageInventory(actor)) return { status: "forbidden" };
  const correlationId = input.correlationId ?? randomUUID();
  return db.$transaction(async (tx): Promise<CancelOrderResult> => {
    const order = await tx.purchaseOrder.findFirst({
      where: { id: input.orderId, tenantId: actor.tenantId },
      select: { id: true, status: true, storeId: true, lines: { select: { receivedQuantity: true } } },
    });
    if (!order) return { status: "not_found" };
    if (order.status === "CANCELLED") return { status: "conflict", reason: "This order is already cancelled." };
    if (order.lines.some((l) => l.receivedQuantity > 0)) {
      return { status: "conflict", reason: "Goods have been received against this order, so it can't be cancelled." };
    }
    // Conditional update so a receipt racing the cancel cannot both succeed.
    const updated = await tx.purchaseOrder.updateMany({
      where: { id: order.id, tenantId: actor.tenantId, status: "OPEN", lines: { none: { receivedQuantity: { gt: 0 } } } },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    if (updated.count !== 1) return { status: "conflict", reason: "This order changed. Reload and try again." };
    await enqueueOutboxEvent(tx, {
      tenantId: actor.tenantId,
      storeId: order.storeId,
      eventType: "PurchaseOrderCancelled",
      entityId: order.id,
      correlationId,
      actorUserId: actor.userId,
      payload: { orderId: order.id },
    });
    await writeAuditLogTx(tx, {
      tenantId: actor.tenantId,
      userId: actor.userId,
      action: "PurchaseOrderCancelled",
      correlationId,
      metadata: { orderId: order.id },
    });
    return { status: "ok" };
  });
}

export async function listPurchaseOrders(params: { tenantId: string; storeId: string; limit?: number }) {
  const orders = await db.purchaseOrder.findMany({
    where: { tenantId: params.tenantId, storeId: params.storeId },
    orderBy: { createdAt: "desc" },
    take: params.limit ?? 50,
    select: {
      id: true,
      status: true,
      expectedDate: true,
      taxableMinor: true,
      createdAt: true,
      erpnextName: true,
      erpSyncStatus: true,
      supplier: { select: { name: true } },
      lines: { select: { quantity: true, receivedQuantity: true } },
    },
  });
  return orders.map((o) => ({ ...o, progress: orderProgress(o) }));
}

export async function getPurchaseOrder(params: { tenantId: string; orderId: string }) {
  const order = await db.purchaseOrder.findFirst({
    where: { id: params.orderId, tenantId: params.tenantId },
    select: {
      id: true,
      storeId: true,
      supplierId: true,
      status: true,
      expectedDate: true,
      notes: true,
      taxableMinor: true,
      createdAt: true,
      cancelledAt: true,
      erpnextName: true,
      erpSyncStatus: true,
      supplier: { select: { name: true, gstin: true } },
      store: { select: { name: true } },
      lines: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          quantity: true,
          receivedQuantity: true,
          unitCostMinor: true,
          gstRateBp: true,
          variant: { select: { sku: true, size: true, colour: true, product: { select: { name: true } } } },
        },
      },
      receipts: {
        orderBy: { createdAt: "desc" },
        select: { id: true, supplierInvoiceNo: true, createdAt: true, totalMinor: true },
      },
    },
  });
  return order ? { ...order, progress: orderProgress(order) } : null;
}
