import { db } from "@/server/db";
import { Prisma, StockMovementType, SaleStatus, PaymentStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { writeAuditLog } from "@/server/identity/audit";
import { enqueueOutboxEvent } from "@/server/events/outbox";
import { applyStockMovement } from "@/server/inventory/stockLedger";
import { canAuthorizeReturn } from "@/server/sales/returnRoles";
import { canHandleCash, expectedDrawerCash } from "@/server/pos/cashRegister";
import { createSale, type CreateSaleInput } from "@/server/sales/saleService";

export class ExchangeDomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "ExchangeDomainError";
  }
}

export interface ProcessExchangeInput {
  tenantId: string;
  storeId: string;
  originalSaleId: string;
  actor: {
    userId: string;
    tenantRole: "OWNER" | "STAFF";
    membershipRole: string | null;
  };
  posSessionId?: string | null;
  returnItems: {
    originalSaleItemId: string;
    quantity: number;
  }[];
  newLines: {
    variantId: string;
    quantity: number;
  }[];
  settlement: {
    method: "CASH" | "UPI" | "CARD";
    reference?: string;
  };
  reason: string;
  /** Client-generated once per exchange, so a double tap or a network retry returns the first one. */
  idempotencyKey: string;
}

/**
 * Unified Exchange Engine (Screen D2 / 20)
 *
 * Processes customer exchange in a single transactional step:
 * 1. Validates and processes item return (stock increment + value calculation).
 * 2. Creates the new replacement sale (stock decrement + pricing).
 * 3. Computes net settlement:
 *    - If new sale total > return value: Customer pays difference.
 *    - If new sale total < return value: Store refunds difference to customer.
 *    - If equal: zero difference.
 * 4. Links both records mutually via outbox & audit trail.
 */
export async function processExchange(input: ProcessExchangeInput) {
  if (!canAuthorizeReturn(input.actor)) {
    throw new ExchangeDomainError("FORBIDDEN", "Only a store manager or the owner can authorise an exchange.");
  }

  if (input.returnItems.length === 0 || input.newLines.length === 0) {
    throw new ExchangeDomainError("INVALID_INPUT", "An exchange requires at least one returned item and one replacement item.");
  }

  const exchangeId = `EXC-${input.idempotencyKey}`;
  const replay = await findExchange(input.tenantId, exchangeId);
  if (replay) return replay;

  // 1. Fetch original sale
  const originalSale = await db.sale.findUnique({
    where: { id: input.originalSaleId },
    include: {
      items: true,
      returns: { include: { items: true } },
    },
  });

  if (!originalSale || originalSale.tenantId !== input.tenantId) {
    throw new ExchangeDomainError("NOT_FOUND", "Original bill not found.");
  }

  if (originalSale.storeId !== input.storeId) {
    throw new ExchangeDomainError("FORBIDDEN", "Cross-store exchanges are not permitted.");
  }

  if (originalSale.status !== SaleStatus.COMPLETED) {
    throw new ExchangeDomainError("INVALID_STATUS", "Only completed bills can be exchanged.");
  }

  // Compute return value & check returnable quantities
  const saleItemMap = new Map(originalSale.items.map((i) => [i.id, i]));
  const alreadyReturnedMap = new Map<string, number>();
  for (const ret of originalSale.returns) {
    for (const ri of ret.items) {
      alreadyReturnedMap.set(ri.originalSaleItemId, (alreadyReturnedMap.get(ri.originalSaleItemId) ?? 0) + ri.quantity);
    }
  }

  let totalReturnCreditMinor = 0;
  for (const item of input.returnItems) {
    const saleItem = saleItemMap.get(item.originalSaleItemId);
    if (!saleItem) {
      throw new ExchangeDomainError("ITEM_NOT_FOUND", `Item ${item.originalSaleItemId} not in original sale.`);
    }
    const alreadyReturned = alreadyReturnedMap.get(item.originalSaleItemId) ?? 0;
    const remaining = saleItem.quantity - alreadyReturned;
    if (item.quantity > remaining) {
      throw new ExchangeDomainError("EXCEEDED_QUANTITY", `Cannot return ${item.quantity} of ${saleItem.nameSnapshot}. Only ${remaining} returnable.`);
    }

    const itemRefundMinor = Math.round(saleItem.lineTotalMinor * (item.quantity / saleItem.quantity));
    totalReturnCreditMinor += itemRefundMinor;
  }

  // 2. Transact the Return, the Replacement Sale, and the Net Settlement. A concurrent request with
  // the same key loses on SaleReturn's (tenantId, idempotencyKey) unique constraint; the catch below
  // returns the winner's exchange instead.
  const result = await db.$transaction(async (tx) => {
    // A. Generate Sale Return
    const saleReturn = await tx.saleReturn.create({
      data: {
        tenantId: input.tenantId,
        storeId: input.storeId,
        originalSaleId: originalSale.id,
        status: SaleStatus.COMPLETED,
        processedByUserId: input.actor.userId,
        posSessionId: input.posSessionId ?? null,
        totalRefundMinor: totalReturnCreditMinor,
        reason: `[EXCHANGE] ${input.reason}`,
        idempotencyKey: exchangeId,
        amburaxExchangeId: exchangeId,
        items: {
          create: input.returnItems.map((item) => {
            const saleItem = saleItemMap.get(item.originalSaleItemId)!;
            const lineRefundMinor = Math.round(saleItem.lineTotalMinor * (item.quantity / saleItem.quantity));
            return {
              originalSaleItemId: item.originalSaleItemId,
              quantity: item.quantity,
              refundMinor: lineRefundMinor,
            };
          }),
        },
      },
    });

    for (const item of input.returnItems) {
      const saleItem = saleItemMap.get(item.originalSaleItemId)!;
      // Stock back to inventory
      await applyStockMovement(tx, {
        tenantId: input.tenantId,
        storeId: input.storeId,
        variantId: saleItem.variantId,
        type: StockMovementType.RETURN,
        quantityDelta: item.quantity,
        referenceType: "SALE_RETURN",
        referenceId: saleReturn.id,
        actorUserId: input.actor.userId,
        idempotencyKey: `RET_LINE:${saleReturn.id}:${item.originalSaleItemId}`,
      });
    }

    // B. Create the replacement sale
    const correlationId = randomUUID();
    const saleRes = await createSale({
      tenantId: input.tenantId,
      storeId: input.storeId,
      cashierUserId: input.actor.userId,
      idempotencyKey: `NEW_SALE_${exchangeId}`,
      lines: input.newLines,
      customerId: originalSale.customerId,
      posSessionId: input.posSessionId,
      correlationId,
      payment: {
        method: input.settlement.method,
        reference: input.settlement.reference,
      },
    });

    if (saleRes.status !== "ok") {
      throw new ExchangeDomainError("SALE_CREATION_FAILED", "Failed to generate replacement sale for exchange items.");
    }

    const newSaleTotalMinor = saleRes.sale.totalMinor;
    const netDifferenceMinor = newSaleTotalMinor - totalReturnCreditMinor;

    // C. Record exchange link in Audit Log
    await writeAuditLog({
      tenantId: input.tenantId,
      userId: input.actor.userId,
      action: "sale.exchanged",
      correlationId: randomUUID(),
      metadata: {
        exchangeId,
        originalSaleId: originalSale.id,
        returnId: saleReturn.id,
        newSaleId: saleRes.sale.id,
        returnCreditMinor: totalReturnCreditMinor,
        newSaleTotalMinor,
        netDifferenceMinor,
        settlementMethod: input.settlement.method,
      },
    });

    return {
      exchangeId,
      saleReturn,
      newSale: saleRes.sale,
      returnCreditMinor: totalReturnCreditMinor,
      newSaleTotalMinor,
      netDifferenceMinor,
    };
  }).catch(async (err) => {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await findExchange(input.tenantId, exchangeId);
      if (winner) return winner;
    }
    throw err;
  });

  return result;
}

/** The exchange already recorded under this id, rebuilt from its return and replacement sale. */
async function findExchange(tenantId: string, exchangeId: string) {
  const saleReturn = await db.saleReturn.findUnique({
    where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: exchangeId } },
  });
  if (!saleReturn) return null;
  const newSale = await db.sale.findFirst({ where: { tenantId, idempotencyKey: `NEW_SALE_${exchangeId}` } });
  if (!newSale) return null;
  return {
    exchangeId,
    saleReturn,
    newSale,
    returnCreditMinor: saleReturn.totalRefundMinor,
    newSaleTotalMinor: newSale.totalMinor,
    netDifferenceMinor: newSale.totalMinor - saleReturn.totalRefundMinor,
    replayed: true as const,
  };
}
