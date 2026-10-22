import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAuditLogTx } from "@/server/identity/audit";
import { enqueueOutboxEvent } from "@/server/events/outbox";
import { canManageInventory } from "@/server/inventory/inventoryRoles";
import { applyStockMovement, movementKey, validateMovementQuantity } from "@/server/inventory/stockLedger";
import { MAX_PRICE_MINOR, applyOrQueuePriceChange } from "@/server/inventory/priceChanges";

/**
 * Purchase receipts: goods arriving from a supplier against their invoice.
 *
 * Owner decision 2026-10-13: cost is recorded EXCLUDING GST and the input GST is stored
 * separately, line by line. Every line adds stock through the ledger as a RECEIPT carrying its
 * cost, in one transaction with the receipt, so a receipt and its stock can never disagree. The
 * ledger's StockMovementCreated event carries the cost to ERPNext as the receipt rate.
 *
 * Goods can be received against a purchase order (screens 47-48): every line then cites its order
 * line, and the order's received quantity rises in the same transaction. Receiving more than was
 * ordered is refused (ERPNext's default over-receipt allowance is 0%).
 *
 * Not here: supplier payables and payments (ERPNext's).
 */

/** Thrown inside the transaction when an order line would be over-received; rolls everything back. */
class OverReceiptError extends Error {}

export const MAX_RECEIPT_LINES = 200;

export interface ReceiptLineInput {
  sku: string;
  quantity: number;
  unitCostMinor: number;
  gstRateBp: number;
  priceMinor?: number | null;
  mrpMinor?: number | null;
  updatePrice?: boolean;
  pricePolicy?: "now" | "after_older_stock";
  /** The order line these goods were ordered on, when receiving against a purchase order. */
  purchaseOrderLineId?: string;
}

export interface CreatePurchaseReceiptInput {
  actor: { tenantId: string; userId: string; tenantRole: "OWNER" | "STAFF"; membershipRole: string | null };
  storeId: string;
  supplierId: string;
  supplierInvoiceNo: string;
  supplierInvoiceDate?: Date | null;
  notes?: string | null;
  lines: ReceiptLineInput[];
  /** Receive against this purchase order: same store and supplier, every line citing its order line. */
  purchaseOrderId?: string | null;
  idempotencyKey: string;
  correlationId?: string;
  /** When true, cashiers can proceed past soft warnings for similar bills across other FYs/dates */
  acknowledgeSimilarBill?: boolean;
}

export type CreatePurchaseReceiptResult =
  | { status: "ok"; receiptId: string; duplicate: boolean }
  | { status: "forbidden" }
  | { status: "not_found"; what: "store" | "supplier" | "order" }
  | { status: "unknown_sku"; sku: string }
  | { status: "validation_error"; reason: string }
  | { status: "duplicate_supplier_invoice"; receiptId: string; date: Date | null }
  | { status: "similar_supplier_invoice"; receiptId: string; date: Date | null; invoiceNo: string };

/** Input GST on a line: what the supplier charged on top of the cost, rounded per line. */
export function lineInputTax(taxableMinor: number, gstRateBp: number): number {
  return Math.round((taxableMinor * gstRateBp) / 10_000);
}

function validateLines(lines: ReceiptLineInput[]): string | null {
  if (lines.length === 0) return "Add at least one item.";
  if (lines.length > MAX_RECEIPT_LINES) return `A receipt can have at most ${MAX_RECEIPT_LINES} lines.`;
  for (const [i, l] of lines.entries()) {
    const n = i + 1;
    if (!l.sku || !l.sku.trim()) return `Line ${n}: enter a SKU.`;
    if (validateMovementQuantity(l.quantity) || l.quantity <= 0) return `Line ${n}: enter a whole quantity above zero.`;
    if (!Number.isSafeInteger(l.unitCostMinor) || l.unitCostMinor < 0 || l.unitCostMinor > MAX_PRICE_MINOR) {
      return `Line ${n}: enter a valid cost.`;
    }
    if (!Number.isSafeInteger(l.gstRateBp) || l.gstRateBp < 0 || l.gstRateBp > 10_000) {
      return `Line ${n}: choose a valid GST rate.`;
    }
    if (l.updatePrice && l.priceMinor != null) {
      if (!Number.isSafeInteger(l.priceMinor) || l.priceMinor <= 0 || l.priceMinor > MAX_PRICE_MINOR) {
        return `Line ${n}: enter a valid selling price.`;
      }
      if (l.mrpMinor != null) {
        if (!Number.isSafeInteger(l.mrpMinor) || l.mrpMinor <= 0 || l.mrpMinor > MAX_PRICE_MINOR) {
          return `Line ${n}: enter a valid MRP.`;
        }
        if (l.priceMinor > l.mrpMinor) {
          return `Line ${n}: the selling price cannot be higher than the MRP.`;
        }
      }
    }
  }
  return null;
}

export async function createPurchaseReceipt(input: CreatePurchaseReceiptInput): Promise<CreatePurchaseReceiptResult> {
  const { actor } = input;
  if (!canManageInventory(actor)) return { status: "forbidden" };

  const existing = await db.purchaseReceipt.findUnique({
    where: { tenantId_idempotencyKey: { tenantId: actor.tenantId, idempotencyKey: input.idempotencyKey } },
    select: { id: true },
  });
  if (existing) return { status: "ok", receiptId: existing.id, duplicate: true };

  const invoiceNo = input.supplierInvoiceNo.trim();
  if (invoiceNo.length < 1 || invoiceNo.length > 60) {
    return { status: "validation_error", reason: "Enter the supplier's invoice number." };
  }
  const lineError = validateLines(input.lines);
  if (lineError) return { status: "validation_error", reason: lineError };

  const [store, supplier] = await Promise.all([
    db.store.findFirst({ where: { id: input.storeId, tenantId: actor.tenantId }, select: { id: true } }),
    db.supplier.findFirst({
      where: { id: input.supplierId, tenantId: actor.tenantId, isActive: true },
      select: { id: true, name: true },
    }),
  ]);
  if (!store) return { status: "not_found", what: "store" };
  if (!supplier) return { status: "not_found", what: "supplier" };

  // Soft warning & pre-check for existing bills with the same normalized invoice number
  const effectiveDate = input.supplierInvoiceDate ?? new Date();
  const existingMatches: Array<{
    id: string;
    supplierInvoiceNo: string;
    supplierInvoiceDate: Date | null;
    createdAt: Date;
    fy: number;
    target_fy: number;
  }> = await db.$queryRaw`
    SELECT 
      "id", 
      "supplierInvoiceNo", 
      "supplierInvoiceDate", 
      "createdAt",
      get_financial_year_ist(COALESCE("supplierInvoiceDate", "createdAt")) AS fy,
      get_financial_year_ist(${effectiveDate}::timestamp) AS target_fy
    FROM "purchase_receipts"
    WHERE "tenantId" = ${actor.tenantId}
      AND "supplierId" = ${supplier.id}
      AND normalize_product_key("supplierInvoiceNo") = normalize_product_key(${invoiceNo})
    LIMIT 1;
  `;

  if (existingMatches.length > 0) {
    const match = existingMatches[0]!;
    if (match.fy === match.target_fy) {
      // Exact duplicate bill in the SAME financial year -> hard block
      return {
        status: "duplicate_supplier_invoice",
        receiptId: match.id,
        date: match.supplierInvoiceDate ?? match.createdAt,
      };
    } else if (!input.acknowledgeSimilarBill) {
      // Same number but in a DIFFERENT financial year -> soft warning
      return {
        status: "similar_supplier_invoice",
        receiptId: match.id,
        date: match.supplierInvoiceDate ?? match.createdAt,
        invoiceNo: match.supplierInvoiceNo,
      };
    }
  }

  const skus = [...new Set(input.lines.map((l) => l.sku.trim()))];
  const variants = await db.productVariant.findMany({
    where: { tenantId: actor.tenantId, sku: { in: skus } },
    select: { id: true, sku: true },
  });
  const bySku = new Map(variants.map((v) => [v.sku, v.id]));
  for (const sku of skus) if (!bySku.has(sku)) return { status: "unknown_sku", sku };

  let purchaseOrderId: string | null = null;
  if (input.purchaseOrderId) {
    const order = await db.purchaseOrder.findFirst({
      where: { id: input.purchaseOrderId, tenantId: actor.tenantId },
      select: { id: true, status: true, storeId: true, supplierId: true, lines: { select: { id: true, variantId: true } } },
    });
    if (!order) return { status: "not_found", what: "order" };
    if (order.status !== "OPEN") return { status: "validation_error", reason: "This order is cancelled." };
    if (order.storeId !== store.id) return { status: "validation_error", reason: "This order is for another store." };
    if (order.supplierId !== supplier.id) return { status: "validation_error", reason: "This order is with another supplier." };
    const orderLines = new Map(order.lines.map((l) => [l.id, l.variantId]));
    const cited = new Set<string>();
    for (const [i, l] of input.lines.entries()) {
      const variantId = l.purchaseOrderLineId ? orderLines.get(l.purchaseOrderLineId) : undefined;
      if (!variantId || variantId !== bySku.get(l.sku.trim()) || cited.has(l.purchaseOrderLineId!)) {
        return { status: "validation_error", reason: `Line ${i + 1}: this item is not on the order.` };
      }
      cited.add(l.purchaseOrderLineId!);
    }
    purchaseOrderId = order.id;
  } else if (input.lines.some((l) => l.purchaseOrderLineId)) {
    return { status: "validation_error", reason: "Order lines need their purchase order." };
  }

  const priced = input.lines.map((l) => {
    const taxableMinor = l.quantity * l.unitCostMinor;
    return {
      purchaseOrderLineId: purchaseOrderId ? l.purchaseOrderLineId! : null,
      variantId: bySku.get(l.sku.trim())!,
      quantity: l.quantity,
      unitCostMinor: l.unitCostMinor,
      gstRateBp: l.gstRateBp,
      taxableMinor,
      inputTaxMinor: lineInputTax(taxableMinor, l.gstRateBp),
      priceMinor: l.priceMinor,
      mrpMinor: l.mrpMinor,
      updatePrice: Boolean(l.updatePrice),
      pricePolicy: l.pricePolicy ?? "after_older_stock",
    };
  });
  const taxableMinor = priced.reduce((s, l) => s + l.taxableMinor, 0);
  const inputTaxMinor = priced.reduce((s, l) => s + l.inputTaxMinor, 0);
  if (taxableMinor + inputTaxMinor > 2_147_483_647) {
    return { status: "validation_error", reason: "This receipt is too large to record in one go." };
  }
  const correlationId = input.correlationId ?? randomUUID();
  const notes = input.notes?.trim() ? input.notes.trim().slice(0, 500) : null;

  try {
    const receiptId = await db.$transaction(async (tx) => {
      const receipt = await tx.purchaseReceipt.create({
        data: {
          tenantId: actor.tenantId,
          storeId: store.id,
          supplierId: supplier.id,
          supplierInvoiceNo: invoiceNo,
          supplierInvoiceDate: input.supplierInvoiceDate ?? null,
          notes,
          taxableMinor,
          inputTaxMinor,
          totalMinor: taxableMinor + inputTaxMinor,
          createdByUserId: actor.userId,
          idempotencyKey: input.idempotencyKey,
          purchaseOrderId,
        },
        select: { id: true },
      });

      for (const [i, line] of priced.entries()) {
        if (line.purchaseOrderLineId) {
          // Atomic: only raises the received quantity while it stays within what was ordered and the
          // order is still open, so two receipts racing on one order can never over-receive it.
          const raised = await tx.$executeRaw`
            UPDATE "purchase_order_lines" l
               SET "receivedQuantity" = l."receivedQuantity" + ${line.quantity}
              FROM "purchase_orders" o
             WHERE l."id" = ${line.purchaseOrderLineId} AND l."tenantId" = ${actor.tenantId}
               AND o."id" = l."orderId" AND o."tenantId" = l."tenantId" AND o."status" = 'OPEN'
               AND l."receivedQuantity" + ${line.quantity} <= l."quantity"
          `;
          if (raised !== 1) throw new OverReceiptError(`Line ${i + 1}`);
        }
        const key = movementKey.receipt(`purchase:${receipt.id}:${i}`);

        // Read older on-hand units across stores before this receipt adds stock
        const olderLevels = await tx.stockLevel.findMany({
          where: { tenantId: actor.tenantId, variantId: line.variantId },
          select: { quantity: true },
        });
        const olderUnits = olderLevels.reduce((sum, s) => sum + Math.max(0, s.quantity), 0);

        const movement = await applyStockMovement(tx, {
          tenantId: actor.tenantId,
          storeId: store.id,
          variantId: line.variantId,
          type: "RECEIPT",
          quantityDelta: line.quantity,
          reason: `Purchase ${invoiceNo} from ${supplier.name}`.slice(0, 200),
          referenceType: "PURCHASE_RECEIPT",
          referenceId: receipt.id,
          actorUserId: actor.userId,
          unitCostMinor: line.unitCostMinor,
          idempotencyKey: key,
        });

        // Update master variant's costPriceMinor with latest purchase cost
        if (line.unitCostMinor != null && line.unitCostMinor > 0) {
          await tx.productVariant.update({
            where: { id: line.variantId, tenantId: actor.tenantId },
            data: { costPriceMinor: line.unitCostMinor },
          });
        }

        // Price transition handling (Problem 1 & 2)
        if (line.updatePrice && line.priceMinor != null && line.priceMinor > 0) {
          await applyOrQueuePriceChange(tx, {
            tenantId: actor.tenantId,
            variantId: line.variantId,
            request: {
              priceMinor: line.priceMinor,
              mrpMinor: line.mrpMinor ?? null,
              policy: line.pricePolicy,
            },
            olderUnits,
            actorUserId: actor.userId,
            sourceMovementId: movement.movementId,
            correlationId,
          });
        }

        await tx.purchaseReceiptLine.create({
          data: {
            tenantId: actor.tenantId,
            receiptId: receipt.id,
            variantId: line.variantId,
            quantity: line.quantity,
            unitCostMinor: line.unitCostMinor,
            gstRateBp: line.gstRateBp,
            taxableMinor: line.taxableMinor,
            inputTaxMinor: line.inputTaxMinor,
            stockMovementId: movement.movementId,
            purchaseOrderLineId: line.purchaseOrderLineId,
          },
        });
      }

      // Part 3 Draft Activation:
      // If any items on this receipt are currently draft products, conditionally activate them
      // (WHERE isDraft = true) and enqueue ProductVariantCreated for ALL their variants FIRST,
      // strictly preceding the PurchaseReceiptCreated event.
      const variantIdsOnReceipt = priced.map((l) => l.variantId);
      const draftVariants = await tx.productVariant.findMany({
        where: {
          id: { in: variantIdsOnReceipt },
          tenantId: actor.tenantId,
          product: { isDraft: true },
        },
        select: {
          productId: true,
          product: {
            select: {
              id: true,
              variants: {
                select: {
                  id: true,
                  sku: true,
                  barcode: true,
                  size: true,
                  colour: true,
                  priceMinor: true,
                  costPriceMinor: true,
                  mrpMinor: true,
                  taxTreatment: true,
                  taxRateBp: true,
                  taxRateMode: true,
                },
              },
            },
          },
        },
      });

      const distinctDraftProductIds = [...new Set(draftVariants.map((d) => d.productId))];

      for (const prodId of distinctDraftProductIds) {
        // Atomic conditional update ensures activation happens only once even with concurrent saves
        const updated = await tx.product.updateMany({
          where: { id: prodId, tenantId: actor.tenantId, isDraft: true },
          data: { isDraft: false, draftExpiresAt: null },
        });

        // Enqueue variant events ONLY if this transaction successfully flipped isDraft from true to false
        if (updated.count > 0) {
          const productRecord = draftVariants.find((d) => d.productId === prodId)?.product;
          if (productRecord) {
            for (const v of productRecord.variants) {
              await enqueueOutboxEvent(tx, {
                tenantId: actor.tenantId,
                storeId: store.id,
                eventType: "ProductVariantCreated",
                entityId: v.id,
                correlationId,
                actorUserId: actor.userId,
                payload: {
                  variantId: v.id,
                  productId: prodId,
                  sku: v.sku,
                  barcode: v.barcode,
                  size: v.size,
                  colour: v.colour,
                  priceMinor: v.priceMinor,
                  costPriceMinor: v.costPriceMinor,
                  taxTreatment: v.taxTreatment,
                  taxRateBp: v.taxRateBp,
                  taxRateMode: v.taxRateMode,
                },
              });
            }
          }
        }
      }

      // ERPNext-first: the whole receipt syncs as one Purchase Receipt, which moves the stock in
      // ERPNext. Its lines therefore do NOT also sync as separate Stock Entries.
      await enqueueOutboxEvent(tx, {
        tenantId: actor.tenantId,
        storeId: store.id,
        eventType: "PurchaseReceiptCreated",
        entityId: receipt.id,
        correlationId,
        actorUserId: actor.userId,
        payload: { receiptId: receipt.id },
      });
      await writeAuditLogTx(tx, {
        tenantId: actor.tenantId,
        userId: actor.userId,
        action: "purchase_receipt.created",
        correlationId,
        metadata: {
          receiptId: receipt.id,
          supplierId: supplier.id,
          lines: priced.length,
          totalMinor: taxableMinor + inputTaxMinor,
        },
      });
      return receipt.id;
    });
    return { status: "ok", receiptId, duplicate: false };
  } catch (err) {
    if (err instanceof OverReceiptError) {
      return { status: "validation_error", reason: `${err.message}: that is more than is still due on the order.` };
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const raced = await db.purchaseReceipt.findUnique({
        where: { tenantId_idempotencyKey: { tenantId: actor.tenantId, idempotencyKey: input.idempotencyKey } },
        select: { id: true },
      });
      if (raced) return { status: "ok", receiptId: raced.id, duplicate: true };

      // Check if it collided with the unique supplier invoice FY index
      const existingReceipt = await db.purchaseReceipt.findFirst({
        where: {
          tenantId: actor.tenantId,
          supplierId: supplier.id,
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, supplierInvoiceDate: true, createdAt: true },
      });
      if (existingReceipt) {
        return {
          status: "duplicate_supplier_invoice",
          receiptId: existingReceipt.id,
          date: existingReceipt.supplierInvoiceDate ?? existingReceipt.createdAt,
        };
      }
    }
    throw err;
  }
}

export async function listPurchaseReceipts(params: { tenantId: string; storeId: string; limit?: number }) {
  return db.purchaseReceipt.findMany({
    where: { tenantId: params.tenantId, storeId: params.storeId },
    orderBy: { createdAt: "desc" },
    take: params.limit ?? 50,
    select: {
      id: true,
      supplierInvoiceNo: true,
      supplierInvoiceDate: true,
      taxableMinor: true,
      inputTaxMinor: true,
      totalMinor: true,
      createdAt: true,
      supplier: { select: { name: true } },
      _count: { select: { lines: true } },
    },
  });
}

export async function getPurchaseReceipt(params: { tenantId: string; receiptId: string }) {
  return db.purchaseReceipt.findFirst({
    where: { id: params.receiptId, tenantId: params.tenantId },
    select: {
      id: true,
      supplierInvoiceNo: true,
      supplierInvoiceDate: true,
      notes: true,
      taxableMinor: true,
      inputTaxMinor: true,
      totalMinor: true,
      createdAt: true,
      supplier: { select: { name: true, gstin: true } },
      lines: {
        select: {
          id: true,
          quantity: true,
          unitCostMinor: true,
          gstRateBp: true,
          taxableMinor: true,
          inputTaxMinor: true,
          returnLines: { select: { quantity: true } },
          variant: {
            select: {
              id: true,
              sku: true,
              barcode: true,
              size: true,
              colour: true,
              priceMinor: true,
              mrpMinor: true,
              product: { select: { name: true } },
              pendingPriceChanges: {
                where: { status: "PENDING" },
                select: { newPriceMinor: true, newMrpMinor: true },
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
          },
        },
      },
    },
  });
}
