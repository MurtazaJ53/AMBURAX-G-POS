import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAuditLogTx } from "@/server/identity/audit";
import { enqueueOutboxEvent } from "@/server/events/outbox";
import { canManageInventory } from "@/server/inventory/inventoryRoles";
import { applyStockMovement } from "@/server/inventory/stockLedger";
import { lineInputTax } from "./purchaseReceipts";

/**
 * Returns to supplier, always against the purchase receipt the goods came in on.
 *
 * A line can send back at most what was received on it, less what earlier returns already sent.
 * Each returned unit leaves stock through the ledger (SUPPLIER_RETURN) in one transaction with
 * the return, at the cost it was bought at, and the input GST on it is reversed by the same
 * per-line rounding the receipt used. The weighted average cost of what stays is unchanged.
 * Settling the money with the supplier (a debit note, a refund) is ERPNext's.
 */

export interface PurchaseReturnLineInput {
  receiptLineId: string;
  quantity: number;
}

export type CreatePurchaseReturnResult =
  | { status: "ok"; returnId: string; duplicate: boolean }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "validation_error"; reason: string };

export async function createPurchaseReturn(input: {
  actor: { tenantId: string; userId: string; tenantRole: "OWNER" | "STAFF"; membershipRole: string | null };
  receiptId: string;
  reason: string;
  lines: PurchaseReturnLineInput[];
  idempotencyKey: string;
  correlationId?: string;
}): Promise<CreatePurchaseReturnResult> {
  const { actor } = input;
  if (!canManageInventory(actor)) return { status: "forbidden" };

  const existing = await db.purchaseReturn.findUnique({
    where: { tenantId_idempotencyKey: { tenantId: actor.tenantId, idempotencyKey: input.idempotencyKey } },
    select: { id: true },
  });
  if (existing) return { status: "ok", returnId: existing.id, duplicate: true };

  const reason = input.reason.trim();
  if (reason.length < 3 || reason.length > 200) {
    return { status: "validation_error", reason: "Say why the goods are going back (damaged, wrong size…)." };
  }
  for (const l of input.lines) {
    if (!Number.isSafeInteger(l.quantity) || l.quantity < 0) {
      return { status: "validation_error", reason: "Quantities must be whole numbers." };
    }
  }
  const wanted = input.lines.filter((l) => l.quantity > 0);
  if (wanted.length === 0) return { status: "validation_error", reason: "Enter how many of at least one item go back." };
  if (new Set(wanted.map((l) => l.receiptLineId)).size !== wanted.length) {
    return { status: "validation_error", reason: "Each item can appear once." };
  }

  const correlationId = input.correlationId ?? randomUUID();

  try {
    return await db.$transaction(async (tx) => {
      const receipt = await tx.purchaseReceipt.findFirst({
        where: { id: input.receiptId, tenantId: actor.tenantId },
        select: { id: true, storeId: true, supplierInvoiceNo: true, supplier: { select: { name: true } } },
      });
      if (!receipt) return { status: "not_found" } as const;

      // Lock the receipt's lines so two returns against the same receipt cannot both pass the
      // "not more than is left" check.
      await tx.$queryRaw`
        SELECT "id" FROM "purchase_receipt_lines"
         WHERE "receiptId" = ${receipt.id} AND "tenantId" = ${actor.tenantId}
         FOR UPDATE
      `;
      const receiptLines = await tx.purchaseReceiptLine.findMany({
        where: { receiptId: receipt.id, tenantId: actor.tenantId },
        select: {
          id: true,
          variantId: true,
          quantity: true,
          unitCostMinor: true,
          gstRateBp: true,
          returnLines: { select: { quantity: true } },
        },
      });
      const byId = new Map(receiptLines.map((l) => [l.id, l]));

      const priced: {
        line: (typeof receiptLines)[number];
        quantity: number;
        taxableMinor: number;
        inputTaxMinor: number;
      }[] = [];
      for (const w of wanted) {
        const line = byId.get(w.receiptLineId);
        if (!line) return { status: "validation_error", reason: "An item is not on this purchase." } as const;
        const alreadyReturned = line.returnLines.reduce((s, r) => s + r.quantity, 0);
        const left = line.quantity - alreadyReturned;
        if (w.quantity > left) {
          return {
            status: "validation_error",
            reason: `Only ${left} of an item can still go back (${line.quantity} received, ${alreadyReturned} already returned).`,
          } as const;
        }
        const taxableMinor = w.quantity * line.unitCostMinor;
        priced.push({ line, quantity: w.quantity, taxableMinor, inputTaxMinor: lineInputTax(taxableMinor, line.gstRateBp) });
      }

      const taxableMinor = priced.reduce((s, p) => s + p.taxableMinor, 0);
      const inputTaxMinor = priced.reduce((s, p) => s + p.inputTaxMinor, 0);
      const created = await tx.purchaseReturn.create({
        data: {
          tenantId: actor.tenantId,
          receiptId: receipt.id,
          reason,
          taxableMinor,
          inputTaxMinor,
          totalMinor: taxableMinor + inputTaxMinor,
          createdByUserId: actor.userId,
          idempotencyKey: input.idempotencyKey,
        },
        select: { id: true },
      });

      for (const p of priced) {
        const key = `SUPPLIER_RETURN:${created.id}:${p.line.id}`;
        const movement = await applyStockMovement(tx, {
          tenantId: actor.tenantId,
          storeId: receipt.storeId,
          variantId: p.line.variantId,
          type: "SUPPLIER_RETURN",
          quantityDelta: -p.quantity,
          reason: `Returned to ${receipt.supplier.name} (invoice ${receipt.supplierInvoiceNo}): ${reason}`.slice(0, 200),
          referenceType: "PURCHASE_RETURN",
          referenceId: created.id,
          actorUserId: actor.userId,
          idempotencyKey: key,
        });
        await tx.purchaseReturnLine.create({
          data: {
            tenantId: actor.tenantId,
            returnId: created.id,
            receiptLineId: p.line.id,
            quantity: p.quantity,
            taxableMinor: p.taxableMinor,
            inputTaxMinor: p.inputTaxMinor,
            stockMovementId: movement.movementId,
          },
        });
      }

      // ERPNext-first: one Purchase Return (a Purchase Receipt with is_return) moves the stock.
      await enqueueOutboxEvent(tx, {
        tenantId: actor.tenantId,
        storeId: receipt.storeId,
        eventType: "PurchaseReturnCreated",
        entityId: created.id,
        correlationId,
        actorUserId: actor.userId,
        payload: { returnId: created.id, receiptId: receipt.id },
      });
      await writeAuditLogTx(tx, {
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: "purchase_return.created",
        correlationId,
        metadata: { returnId: created.id, receiptId: receipt.id, totalMinor: taxableMinor + inputTaxMinor },
      });
      return { status: "ok", returnId: created.id, duplicate: false } as const;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const raced = await db.purchaseReturn.findUnique({
        where: { tenantId_idempotencyKey: { tenantId: actor.tenantId, idempotencyKey: input.idempotencyKey } },
        select: { id: true },
      });
      if (raced) return { status: "ok", returnId: raced.id, duplicate: true };
    }
    throw err;
  }
}

export async function listPurchaseReturns(params: { tenantId: string; receiptId: string }) {
  return db.purchaseReturn.findMany({
    where: { tenantId: params.tenantId, receiptId: params.receiptId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      reason: true,
      taxableMinor: true,
      inputTaxMinor: true,
      totalMinor: true,
      createdAt: true,
      lines: {
        select: {
          id: true,
          quantity: true,
          receiptLine: { select: { variant: { select: { sku: true, product: { select: { name: true } } } } } },
        },
      },
    },
  });
}
