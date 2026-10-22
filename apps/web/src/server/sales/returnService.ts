import { db } from "@/server/db";
import { Prisma, StockMovementType, SaleStatus, PaymentStatus } from "@prisma/client";
import { randomUUID } from "crypto";
import { enqueueOutboxEvent } from "@/server/events/outbox";
import { canAuthorizeReturn } from "@/server/sales/returnRoles";
import { canHandleCash, expectedDrawerCash, lockSession } from "@/server/pos/cashRegister";
import { onReturnCompleted } from "@/server/loyalty/loyalty";

export class ReturnDomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "ReturnDomainError";
  }
}

export interface CreateReturnInput {
  tenantId: string;
  storeId: string;
  /**
   * Who is asking. Resolved from the session by the caller — never from the request body, which
   * is why this carries roles rather than a user id the client could name.
   */
  actor: {
    userId: string;
    tenantRole: "OWNER" | "STAFF";
    membershipRole: string | null;
  };
  /**
   * E7 (owner 2026-10-14): the till session that actually pays the refund. Required for any cash
   * refund; recorded for electronic refunds when given. Never inferred from the original sale.
   */
  posSessionId?: string | null;
  originalSaleId: string;
  idempotencyKey: string;
  reason?: string;
  amburaxExchangeId?: string;
  items: {
    originalSaleItemId: string;
    quantity: number;
  }[];
  refundPayments: {
    method: "CASH" | "UPI" | "CARD";
    amountMinor: number;
    reference?: string;
  }[];
}

export async function createReturn(input: CreateReturnInput) {
  // 0. Authorization. First, before even the idempotency lookup: an unauthorised caller must
  // not be able to learn whether a given key already exists, and must never reach a write.
  if (!canAuthorizeReturn(input.actor)) {
    throw new ReturnDomainError(
      "FORBIDDEN",
      "Only a store manager or the owner can authorise a return.",
    );
  }

  // 1. Idempotency Check
  const existing = await db.saleReturn.findUnique({
    where: {
      tenantId_idempotencyKey: {
        tenantId: input.tenantId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    include: {
      items: true,
      payments: true,
    },
  });

  if (existing) {
    return { saleReturn: existing, duplicate: true };
  }

  // 2. Original Sale Validation & Isolation
  const sale = await db.sale.findUnique({
    where: { id: input.originalSaleId },
    include: {
      items: true,
      payments: true,
    },
  });

  if (!sale) {
    throw new ReturnDomainError("NOT_FOUND", "Original sale not found.");
  }

  if (sale.tenantId !== input.tenantId) {
    throw new ReturnDomainError("FORBIDDEN", "Tenant isolation violation.");
  }

  if (sale.storeId !== input.storeId) {
    throw new ReturnDomainError("FORBIDDEN", "Cross-store returns are not permitted.");
  }

  if (sale.status !== SaleStatus.COMPLETED) {
    throw new ReturnDomainError("BAD_REQUEST", "Cannot return an incomplete sale.");
  }

  // 2b. The paying till (E7). It must be an open shift in this store whose drawer this person may
  // handle; a cash refund cannot be made without one.
  const cashRefundMinor = input.refundPayments.filter((p) => p.method === "CASH").reduce((s, p) => s + p.amountMinor, 0);
  const payoutSessionId = input.posSessionId?.trim() || null;
  if (cashRefundMinor > 0 && !payoutSessionId) {
    throw new ReturnDomainError("TILL_REQUIRED", "Choose the till the cash refund is paid from.");
  }
  if (payoutSessionId) {
    const till = await db.posSession.findFirst({
      where: { id: payoutSessionId, tenantId: input.tenantId },
      select: { storeId: true, cashierUserId: true, closedAt: true },
    });
    if (!till || till.storeId !== input.storeId) throw new ReturnDomainError("BAD_REQUEST", "That till is not in this store.");
    if (till.closedAt) throw new ReturnDomainError("BAD_REQUEST", "That till's shift is closed.");
    const allowed = await canHandleCash(
      { tenantId: input.tenantId, userId: input.actor.userId, tenantRole: input.actor.tenantRole },
      till,
    );
    if (!allowed) throw new ReturnDomainError("FORBIDDEN", "You can't pay refunds from that till.");
  }

  // 3. Khata Validation & Money Rules
  const totalRefundRequested = input.refundPayments.reduce((sum, p) => sum + p.amountMinor, 0);
  const totalPaidMinor = sale.payments.reduce((sum, p) => sum + p.amountMinor, 0);
  const isKhataSale = sale.totalMinor > totalPaidMinor;

  // Find previous cash refunds
  const previousReturns = await db.saleReturn.findMany({
    where: { originalSaleId: sale.id },
    include: { payments: true },
  });

  const previousRefundedCash = previousReturns.reduce((sum, ret) =>
    sum + ret.payments.reduce((psum, p) => psum + p.amountMinor, 0), 0
  );

  const maxCashRefundAllowed = totalPaidMinor - previousRefundedCash;

  if (isKhataSale && totalRefundRequested > maxCashRefundAllowed) {
    throw new ReturnDomainError("BAD_REQUEST", "Refund exceeds collected cash. Must reverse Khata receivable first.");
  }

  // 4. Atomic Concurrency & Stock Validation
  try {
  return await db.$transaction(async (tx) => {
    let totalCalculatedRefundMinor = 0;
    const returnItemsData: any[] = [];

    for (const returnReq of input.items) {
      if (returnReq.quantity <= 0) {
        throw new ReturnDomainError("BAD_REQUEST", "Return quantity must be positive.");
      }

      const originalItem = sale.items.find((i) => i.id === returnReq.originalSaleItemId);
      if (!originalItem) {
        throw new ReturnDomainError("BAD_REQUEST", `SaleItem ${returnReq.originalSaleItemId} does not belong to this sale.`);
      }

      // Concurrency protection: Lock the original sale item conceptually by aggregating current state inside Serializable tx
      const existingReturnItems = await tx.saleReturnItem.aggregate({
        where: { originalSaleItemId: originalItem.id },
        _sum: { quantity: true },
      });

      const alreadyReturned = existingReturnItems._sum.quantity || 0;

      if (alreadyReturned + returnReq.quantity > originalItem.quantity) {
        throw new ReturnDomainError("BAD_REQUEST", "Return quantity exceeds originally sold quantity.");
      }

      // Historical Price Logic: refund what the customer actually paid for these units, i.e.
      // the line total less its share of any bill discount.
      const paidForLineMinor = originalItem.lineTotalMinor - originalItem.lineDiscountMinor;
      const proratedRefundMinor = Math.round(paidForLineMinor * (returnReq.quantity / originalItem.quantity));
      totalCalculatedRefundMinor += proratedRefundMinor;

      returnItemsData.push({
        originalSaleItemId: originalItem.id,
        quantity: returnReq.quantity,
        refundMinor: proratedRefundMinor,
      });

      // Fetch current stock to append to balance (inside tx to ensure correct balanceAfter)
      const latestStock = await tx.stockMovement.findFirst({
        where: { tenantId: input.tenantId, storeId: input.storeId, variantId: originalItem.variantId },
        orderBy: { createdAt: "desc" },
      });
      const currentBalance = latestStock?.balanceAfter || 0;

      await tx.stockMovement.create({
        data: {
          tenantId: input.tenantId,
          storeId: input.storeId,
          variantId: originalItem.variantId,
          type: StockMovementType.RETURN,
          quantityDelta: returnReq.quantity,
          balanceAfter: currentBalance + returnReq.quantity,
          reason: input.reason || "RETURN",
          idempotencyKey: randomUUID(),
        }
      });
    }

    if (totalRefundRequested > totalCalculatedRefundMinor) {
      throw new ReturnDomainError("BAD_REQUEST", "Requested refund amount exceeds historical item value.");
    }

    // 4b. Cash can't leave a drawer that doesn't hold it (E7). The session row is locked first, so
    // two refunds or a refund and a pay-out can't both spend the same cash.
    if (cashRefundMinor > 0 && payoutSessionId) {
      await lockSession(tx, input.tenantId, payoutSessionId);
      const inDrawer = await expectedDrawerCash(tx, input.tenantId, payoutSessionId);
      if (cashRefundMinor > inDrawer) {
        throw new ReturnDomainError(
          "CASH_SHORT",
          "This till doesn't hold enough cash for the refund. Refund to the original UPI or card instead, or pay it from another till.",
        );
      }
    }

    // 5. Create Domain Objects
    const newReturn = await tx.saleReturn.create({
      data: {
        tenantId: input.tenantId,
        storeId: input.storeId,
        originalSaleId: sale.id,
        status: SaleStatus.COMPLETED,
        totalRefundMinor: totalCalculatedRefundMinor,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        amburaxExchangeId: input.amburaxExchangeId,
        processedByUserId: input.actor.userId,
        posSessionId: payoutSessionId,
        items: {
          create: returnItemsData,
        },
        payments: {
          create: input.refundPayments.map(p => ({
            method: p.method,
            amountMinor: p.amountMinor,
            status: PaymentStatus.CONFIRMED,
            reference: p.reference,
          })),
        },
      },
      include: {
        items: true,
        payments: true,
      },
    });

    await enqueueOutboxEvent(tx, {
      tenantId: input.tenantId,
      storeId: input.storeId,
      eventType: "SaleReturnCreated",
      correlationId: randomUUID(),
      entityId: newReturn.id,
      payload: { saleReturnId: newReturn.id },
    });

    // Decision 41: compensating loyalty entries, inert until finance + GST sign-off.
    await onReturnCompleted(tx, {
      tenantId: input.tenantId,
      saleId: sale.id,
      returnId: newReturn.id,
      currency: sale.currencySnapshot,
      refundMinor: totalCalculatedRefundMinor,
      saleTotalMinor: sale.totalMinor,
    });

    return { saleReturn: newReturn, duplicate: false };
  }, {
    isolationLevel: "Serializable",
  });
  } catch (err) {
    // Two returns (or a return and a payout) touching the same bill or drawer at once: Postgres keeps
    // one and aborts the other. P2034 is Prisma's write conflict; P2010 carrying 40001 is the same
    // serialization failure surfacing from the till's row lock. Say so plainly.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      (err.code === "P2034" || (err.code === "P2010" && JSON.stringify(err.meta ?? {}).includes("40001")))
    ) {
      throw new ReturnDomainError("CONFLICT", "Another return on this bill or till was saved at the same moment (conflict). Try again.");
    }
    throw err;
  }
}
