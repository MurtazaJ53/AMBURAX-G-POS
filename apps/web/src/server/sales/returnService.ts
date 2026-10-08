import { db } from "@/server/db";
import { StockMovementType, SaleStatus, PaymentStatus } from "@prisma/client";
import { randomUUID } from "crypto";
import { enqueueOutboxEvent } from "@/server/events/outbox";

export class ReturnDomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "ReturnDomainError";
  }
}

export interface CreateReturnInput {
  tenantId: string;
  storeId: string;
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

      // Historical Price Logic
      const proratedRefundMinor = Math.round(originalItem.lineTotalMinor * (returnReq.quantity / originalItem.quantity));
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

    return { saleReturn: newReturn, duplicate: false };
  }, {
    isolationLevel: "Serializable",
  });
}
