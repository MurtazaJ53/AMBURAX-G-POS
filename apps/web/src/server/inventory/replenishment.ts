import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAuditLogTx } from "@/server/identity/audit";
import { enqueueOutboxEvent } from "@/server/events/outbox";
import { hasInventoryRightsIn } from "@/server/inventory/stockTransfers";
import { LOW_STOCK_MAX_UNITS } from "@/server/inventory/inventoryQueries";

/**
 * Low stock & replenishment (screen 32), ERPNext-first.
 *
 * - A reorder rule (level + quantity per item per store) mirrors ERPNext's Item Reorder row for the
 *   store's warehouse; ERPNext is the master once connected.
 * - Items without a rule fall back to the shared low-stock line (≤ LOW_STOCK_MAX_UNITS), and the
 *   screen says so — no reorder quantity is invented for them.
 * - A replenishment request becomes a draft ERPNext Material Request (type Purchase); purchasing
 *   turns it into a Purchase Order in ERPNext.
 */

type Actor = { tenantId: string; userId: string; tenantRole: "OWNER" | "STAFF" };

/** ERPNext stores quantities as Float, but AMBURAX counts pieces; these keep inputs sane. */
export const MAX_REORDER_UNITS = 100_000;
export const MAX_REQUEST_LINES = 200;

export interface ReplenishmentRow {
  variantId: string;
  productName: string;
  sku: string;
  size: string | null;
  colour: string | null;
  quantity: number;
  reorderLevel: number | null;
  reorderQty: number | null;
  /** What to order: up to the level plus the reorder quantity, when a rule exists. */
  suggestedQty: number | null;
  lastSupplier: string | null;
  lastCostMinor: number | null;
}

export async function listReplenishment(params: { tenantId: string; storeId: string; limit?: number }) {
  const rows = await db.$queryRaw<
    {
      variantId: string;
      productName: string;
      sku: string;
      size: string | null;
      colour: string | null;
      quantity: number;
      reorderLevel: number | null;
      reorderQty: number | null;
      lastSupplier: string | null;
      lastCostMinor: number | null;
    }[]
  >`
    SELECT sl."variantId", p."name" AS "productName", v."sku", v."size", v."colour", sl."quantity",
           rr."reorderLevel", rr."reorderQty", last_buy."supplier" AS "lastSupplier", last_buy."cost" AS "lastCostMinor"
      FROM "stock_levels" sl
      JOIN "product_variants" v ON v."id" = sl."variantId" AND v."tenantId" = sl."tenantId"
      JOIN "products" p ON p."id" = v."productId" AND p."tenantId" = v."tenantId"
      LEFT JOIN "reorder_rules" rr
        ON rr."tenantId" = sl."tenantId" AND rr."storeId" = sl."storeId" AND rr."variantId" = sl."variantId"
      LEFT JOIN LATERAL (
        SELECT s."name" AS "supplier", l."unitCostMinor" AS "cost"
          FROM "purchase_receipt_lines" l
          JOIN "purchase_receipts" r ON r."id" = l."receiptId" AND r."tenantId" = l."tenantId"
          JOIN "suppliers" s ON s."id" = r."supplierId" AND s."tenantId" = r."tenantId"
         WHERE l."tenantId" = sl."tenantId" AND l."variantId" = sl."variantId"
         ORDER BY r."createdAt" DESC
         LIMIT 1
      ) last_buy ON TRUE
     WHERE sl."tenantId" = ${params.tenantId}
       AND sl."storeId" = ${params.storeId}
       AND sl."quantity" <= COALESCE(rr."reorderLevel", ${LOW_STOCK_MAX_UNITS})
     ORDER BY (sl."quantity" - COALESCE(rr."reorderLevel", ${LOW_STOCK_MAX_UNITS})) ASC, p."name" ASC
     LIMIT ${Math.min(params.limit ?? 200, 500)}
  `;
  return rows.map<ReplenishmentRow>((r) => {
    const quantity = Number(r.quantity);
    const level = r.reorderLevel == null ? null : Number(r.reorderLevel);
    const qty = r.reorderQty == null ? null : Number(r.reorderQty);
    return {
      variantId: r.variantId,
      productName: r.productName,
      sku: r.sku,
      size: r.size,
      colour: r.colour,
      quantity,
      reorderLevel: level,
      reorderQty: qty,
      // ERPNext's own auto-reorder raises the reorder qty; topping a deficit back to the level first
      // means a store that went negative still ends up with the intended cover.
      suggestedQty: level == null || qty == null ? null : Math.max(0, level - quantity) + qty,
      lastSupplier: r.lastSupplier,
      lastCostMinor: r.lastCostMinor == null ? null : Number(r.lastCostMinor),
    };
  });
}

export async function listRecentRequests(params: { tenantId: string; storeId: string; limit?: number }) {
  return db.replenishmentRequest.findMany({
    where: { tenantId: params.tenantId, storeId: params.storeId },
    orderBy: { createdAt: "desc" },
    take: params.limit ?? 10,
    select: {
      id: true,
      createdAt: true,
      erpnextName: true,
      erpSyncStatus: true,
      lines: { select: { quantity: true } },
    },
  });
}

function validUnits(n: number, min: number): boolean {
  return Number.isInteger(n) && n >= min && n <= MAX_REORDER_UNITS;
}

export type SetRulesResult =
  | { status: "ok"; saved: number; cleared: number }
  | { status: "forbidden" }
  | { status: "validation_error"; reason: string };

/**
 * Save reorder levels for several items at once. A level and quantity both blank clears the rule
 * (the item falls back to the shared low-stock line). Each changed rule queues one ERPNext update.
 */
export async function setReorderRules(input: {
  actor: Actor;
  storeId: string;
  rules: { variantId: string; reorderLevel: number | null; reorderQty: number | null }[];
  correlationId?: string;
}): Promise<SetRulesResult> {
  const { actor } = input;
  if (!(await hasInventoryRightsIn(actor, input.storeId))) return { status: "forbidden" };
  if (input.rules.length > MAX_REQUEST_LINES) return { status: "validation_error", reason: "Too many items at once." };
  for (const r of input.rules) {
    if (r.reorderLevel == null && r.reorderQty == null) continue;
    if (r.reorderLevel == null || r.reorderQty == null) {
      return { status: "validation_error", reason: "Give both a reorder level and a reorder quantity, or leave both blank." };
    }
    if (!validUnits(r.reorderLevel, 0) || !validUnits(r.reorderQty, 1)) {
      return {
        status: "validation_error",
        reason: `Levels are whole numbers from 0, and reorder quantities from 1, up to ${MAX_REORDER_UNITS.toLocaleString("en-IN")}.`,
      };
    }
  }
  const variantIds = [...new Set(input.rules.map((r) => r.variantId))];
  if (variantIds.length !== input.rules.length) return { status: "validation_error", reason: "An item appears twice." };
  const known = await db.productVariant.count({ where: { tenantId: actor.tenantId, id: { in: variantIds } } });
  if (known !== variantIds.length) return { status: "validation_error", reason: "An item was not found." };

  const correlationId = input.correlationId ?? randomUUID();
  let saved = 0;
  let cleared = 0;
  await db.$transaction(async (tx) => {
    for (const r of input.rules) {
      const where = {
        tenantId_storeId_variantId: { tenantId: actor.tenantId, storeId: input.storeId, variantId: r.variantId },
      };
      const existing = await tx.reorderRule.findUnique({ where });
      if (r.reorderLevel == null || r.reorderQty == null) {
        if (!existing) continue;
        await tx.reorderRule.delete({ where });
        cleared += 1;
      } else {
        if (existing && existing.reorderLevel === r.reorderLevel && existing.reorderQty === r.reorderQty) continue;
        await tx.reorderRule.upsert({
          where,
          create: {
            tenantId: actor.tenantId,
            storeId: input.storeId,
            variantId: r.variantId,
            reorderLevel: r.reorderLevel,
            reorderQty: r.reorderQty,
            updatedByUserId: actor.userId,
          },
          update: {
            reorderLevel: r.reorderLevel,
            reorderQty: r.reorderQty,
            updatedByUserId: actor.userId,
            erpSyncStatus: "PENDING",
          },
        });
        saved += 1;
      }
      await enqueueOutboxEvent(tx, {
        tenantId: actor.tenantId,
        storeId: input.storeId,
        eventType: "ReorderRuleSet",
        entityId: r.variantId,
        correlationId,
        actorUserId: actor.userId,
        payload: { storeId: input.storeId, variantId: r.variantId },
        discriminator: correlationId,
      });
    }
    if (saved + cleared > 0) {
      await writeAuditLogTx(tx, {
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: "ReorderRulesChanged",
        correlationId,
        metadata: { storeId: input.storeId, saved, cleared },
      });
    }
  });
  return { status: "ok", saved, cleared };
}

export type CreateRequestResult =
  | { status: "ok"; requestId: string; duplicate: boolean }
  | { status: "forbidden" }
  | { status: "validation_error"; reason: string };

/** Ask purchasing for stock. One request → one draft ERPNext Material Request. */
export async function createReplenishmentRequest(input: {
  actor: Actor;
  storeId: string;
  lines: { variantId: string; quantity: number }[];
  note?: string | null;
  idempotencyKey: string;
  correlationId?: string;
}): Promise<CreateRequestResult> {
  const { actor } = input;
  if (!(await hasInventoryRightsIn(actor, input.storeId))) return { status: "forbidden" };

  const existing = await db.replenishmentRequest.findUnique({
    where: { tenantId_idempotencyKey: { tenantId: actor.tenantId, idempotencyKey: input.idempotencyKey } },
    select: { id: true },
  });
  if (existing) return { status: "ok", requestId: existing.id, duplicate: true };

  const lines = input.lines.filter((l) => l.quantity !== 0);
  if (lines.length === 0) return { status: "validation_error", reason: "Enter a quantity for at least one item." };
  if (lines.length > MAX_REQUEST_LINES) return { status: "validation_error", reason: "Too many items in one request." };
  if (lines.some((l) => !validUnits(l.quantity, 1))) {
    return { status: "validation_error", reason: "Quantities are whole numbers of 1 or more." };
  }
  if (new Set(lines.map((l) => l.variantId)).size !== lines.length) {
    return { status: "validation_error", reason: "An item appears twice." };
  }
  const known = await db.productVariant.count({
    where: { tenantId: actor.tenantId, id: { in: lines.map((l) => l.variantId) } },
  });
  if (known !== lines.length) return { status: "validation_error", reason: "An item was not found." };
  // Kept to an ERPNext Data-field length so it syncs without truncation surprises.
  const note = input.note?.trim().slice(0, 140) || null;

  const correlationId = input.correlationId ?? randomUUID();
  try {
    const request = await db.$transaction(async (tx) => {
      const created = await tx.replenishmentRequest.create({
        data: {
          tenantId: actor.tenantId,
          storeId: input.storeId,
          createdByUserId: actor.userId,
          idempotencyKey: input.idempotencyKey,
          note,
          // tenantId on each line comes from the request through the composite relation.
          lines: { create: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })) },
        },
      });
      await enqueueOutboxEvent(tx, {
        tenantId: actor.tenantId,
        storeId: input.storeId,
        eventType: "ReplenishmentRequested",
        entityId: created.id,
        correlationId,
        actorUserId: actor.userId,
        payload: { requestId: created.id },
      });
      await writeAuditLogTx(tx, {
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: "ReplenishmentRequested",
        correlationId,
        metadata: { requestId: created.id, storeId: input.storeId, lines: lines.length },
      });
      return created;
    });
    return { status: "ok", requestId: request.id, duplicate: false };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const again = await db.replenishmentRequest.findUnique({
        where: { tenantId_idempotencyKey: { tenantId: actor.tenantId, idempotencyKey: input.idempotencyKey } },
        select: { id: true },
      });
      if (again) return { status: "ok", requestId: again.id, duplicate: true };
    }
    throw err;
  }
}
