import { db } from "@/server/db";
import { StockMovementType, SaleStatus, PaymentStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { writeAuditLog } from "@/server/identity/audit";
import { enqueueOutboxEvent } from "@/server/events/outbox";
import { applyStockMovement, movementKey } from "@/server/inventory/stockLedger";
import { verifyApprovalPin, listApprovers } from "@/server/identity/approvalPin";
import { erpDate } from "@/server/erp/documentSync";

export class CancelDomainError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "CancelDomainError";
  }
}

export interface CancelSaleInput {
  tenantId: string;
  storeId: string;
  saleId: string;
  actor: {
    userId: string;
    tenantRole: "OWNER" | "STAFF";
    membershipRole: string | null;
  };
  reason: string;
  approval?: {
    approverUserId: string;
    pin: string;
  };
}

/**
 * Bill Cancellation / Void Engine (Screen D1 / D2)
 *
 * Requirements:
 * 1. Same-day or with Manager PIN authorization.
 * 2. Status set to VOIDED atomically.
 * 3. Inventory returned to stock via RETURN stock movement ledger entries.
 * 4. Audit trail logging who voided or approved the cancellation.
 * 5. Outbox event queued for ERP cancellation / reverse posting.
 */
export async function cancelSale(input: CancelSaleInput) {
  const sale = await db.sale.findUnique({
    where: { id: input.saleId },
    include: {
      items: true,
      payments: true,
      returns: true,
    },
  });

  if (!sale) {
    throw new CancelDomainError("NOT_FOUND", "Sale bill not found.");
  }

  if (sale.tenantId !== input.tenantId) {
    throw new CancelDomainError("FORBIDDEN", "Tenant isolation violation.");
  }

  if (sale.storeId !== input.storeId) {
    throw new CancelDomainError("FORBIDDEN", "Cross-store bill cancellation is not permitted.");
  }

  if (sale.status === SaleStatus.VOIDED) {
    throw new CancelDomainError("ALREADY_VOIDED", "This bill has already been cancelled.");
  }

  if (sale.status !== SaleStatus.COMPLETED) {
    throw new CancelDomainError("INVALID_STATUS", "Only completed sales can be cancelled.");
  }

  if (sale.returns.length > 0) {
    throw new CancelDomainError("HAS_RETURNS", "This bill has recorded customer returns. Please process return reversals instead.");
  }

  const isOwnerOrManager = input.actor.tenantRole === "OWNER" || input.actor.membershipRole === "STORE_MANAGER";

  // Same day = the same date in India, the shop's day, not the server's (a UTC server would put a
  // bill rung up after midnight IST on the previous day).
  const isSameDay = erpDate(sale.completedAt) === erpDate(new Date());

  // If not manager/owner, or if not same-day, manager PIN approval is strictly required
  let approverName = null;
  if (!isSameDay || !isOwnerOrManager) {
    if (!input.approval) {
      throw new CancelDomainError("APPROVAL_REQUIRED", "Cancelling this bill requires Manager PIN approval.");
    }

    const pinCheck = await verifyApprovalPin({
      tenantId: input.tenantId,
      storeId: input.storeId,
      approverUserId: input.approval.approverUserId,
      pin: input.approval.pin,
    });

    if (pinCheck.status !== "ok") {
      throw new CancelDomainError("INVALID_PIN", "Invalid or locked Manager Approval PIN.");
    }

    const approver = await db.user.findUnique({
      where: { id: input.approval.approverUserId },
      select: { name: true },
    });
    approverName = approver?.name ?? "Store Manager";
  }

  // Atomically update sale, reverse stock, and create audit log
  const result = await db.$transaction(async (tx) => {
    // 1. Mark sale as VOIDED
    const updatedSale = await tx.sale.update({
      where: { id: sale.id },
      data: {
        status: SaleStatus.VOIDED,
      },
    });

    // 2. Void payments
    await tx.salePayment.updateMany({
      where: { saleId: sale.id },
      data: {
        status: PaymentStatus.FAILED,
      },
    });

    // 3. Reverse inventory movements back into store stock
    for (const item of sale.items) {
      await applyStockMovement(tx, {
        tenantId: input.tenantId,
        storeId: input.storeId,
        variantId: item.variantId,
        type: StockMovementType.RETURN,
        quantityDelta: item.quantity,
        referenceType: "SALE_VOID",
        referenceId: sale.id,
        actorUserId: input.actor.userId,
        idempotencyKey: `SALE_VOID:${sale.id}:${item.id}`,
      });
    }

    // 4. Outbox event: cancel this sale's ERPNext invoice. Its own event, not SaleReturnCreated — a
    // void has no SaleReturn row, so the return adapter could never find it.
    await enqueueOutboxEvent(tx, {
      tenantId: input.tenantId,
      storeId: input.storeId,
      eventType: "SaleVoided",
      correlationId: randomUUID(),
      entityId: sale.id,
      actorUserId: input.actor.userId,
      payload: {
        saleId: sale.id,
        billNumber: sale.billNumber,
        storeId: input.storeId,
        cancelledByUserId: input.actor.userId,
        approverName,
        reason: input.reason,
      },
    });

    // 5. Audit Log
    await writeAuditLog({
      tenantId: input.tenantId,
      userId: input.actor.userId,
      action: "sale.cancelled",
      correlationId: randomUUID(),
      metadata: {
        saleId: sale.id,
        billNumber: sale.billNumber,
        reason: input.reason,
        approverName,
      },
    });

    return updatedSale;
  });

  return { ok: true, sale: result };
}
