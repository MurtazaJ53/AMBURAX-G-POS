import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAuditLog } from "@/server/identity/audit";
import { enqueueOutboxEvent } from "@/server/events/outbox";
import { applyStockMovement, movementKey } from "@/server/inventory/stockLedger";
import { resolveSessionForSale } from "@/server/pos/posSessionService";
import { canSell } from "@/server/sales/sellingRoles";
import { Capability } from "@/server/capability/capabilities";
import { requireCapability } from "@/server/capability/capabilityService";
import {
  computeSaleTotals,
  validateQuantity,
  MAX_LINES_PER_SALE,
  type PricedLine,
} from "@/server/sales/saleTotals";

/**
 * Sale creation — the transactional core of the POS.
 *
 * Four properties this function exists to guarantee, ordered by how badly their absence
 * would hurt:
 *
 * 1. **Nothing financial comes from the browser.** The request carries variant ids,
 *    quantities and a tender; every price, tax rate and total is read from the database and
 *    recomputed here. A tampered client cannot change what is charged or recorded.
 * 2. **A retry cannot ring the sale twice.** `@@unique([tenantId, idempotencyKey])` makes
 *    the database the arbiter, and a collision returns the *original* sale rather than an
 *    error — a double-click must look like success, not a failure the operator retries again.
 * 3. **Everything commits together or not at all.** Sale, items, payment, bill number,
 *    stock projection and the outbox event share one transaction.
 * 4. **Authorization is server-resolved.** Tenant comes from the session; the store and the
 *    caller's membership are re-checked on every sale.
 *
 * What this is NOT: an accounting posting. ERPNext owns the Sales Invoice and the stock
 * ledger (ADR-001). `erpSyncStatus` stays `PENDING` because no adapter exists, and the UI
 * must say so rather than implying the ledger has it.
 */

export interface SaleLineInput {
  variantId: string;
  quantity: number;
}

export interface SalePaymentInput {
  method: "CASH" | "UPI" | "CARD";
  /** Operator-typed UPI/card reference. Never a gateway token — no gateway is integrated. */
  amountMinor?: number;
  reference?: string;
}

export interface CreateSaleInput {
  tenantId: string;
  storeId: string;
  cashierUserId: string;
  /** Caller-supplied request identity. Same key + same tenant = same sale, always. */
  idempotencyKey: string;
  lines: SaleLineInput[];
  customerId?: string | null;
  /**
   * The shift this sale was rung up in. Optional: a back-office sale has no till, and sales
   * predating the POS session model have none either. When supplied it is verified server-side —
   * the client is not trusted to have checked that the shift is open, theirs, or this store's.
   */
  posSessionId?: string | null;
  discountMinor?: number;
  payment?: SalePaymentInput;
  payments?: SalePaymentInput[];
  correlationId: string;
}

export type CreateSaleResult =
  | { status: "forbidden" }
  | { status: "empty_cart" }
  | { status: "too_many_lines" }
  | { status: "invalid_quantity"; variantId: string; reason: string }
  | { status: "unknown_variant"; variantId: string }
  | { status: "inactive_variant"; variantId: string }
  | { status: "unknown_customer" }
  | { status: "validation_error"; reason: string }
  /** The named shift is closed, another cashier's, or another store's. */
  | { status: "invalid_session"; reason: string }
  /** The tenant does not have the RETAIL business module switched on. Not a permission failure. */
  | { status: "capability_disabled"; capability: Capability }
  | { status: "ok"; sale: SaleSummary; duplicate: boolean };

export interface SaleSummary {
  id: string;
  billNumber: string;
  totalMinor: number;
  subtotalMinor: number;
  taxMinor: number;
  discountMinor: number;
  paidMinor: number;
  paymentStatus: string;
  erpSyncStatus: string;
  completedAt: Date;
}

// Selling authority now lives in `sellingRoles.ts` so the POS session service can use it without
// importing this module — see that file for why. Re-exported here so every existing caller and
// test keeps its import path.
export { SELLING_STORE_ROLES, canSell } from "@/server/sales/sellingRoles";

const SALE_SELECT = {
  id: true,
  billNumber: true,
  totalMinor: true,
  subtotalMinor: true,
  taxMinor: true,
  discountMinor: true,
  paidMinor: true,
  erpSyncStatus: true,
  completedAt: true,
  payments: { select: { status: true } },
} as const;

function toSummary(sale: {
  id: string;
  billNumber: string;
  totalMinor: number;
  subtotalMinor: number;
  taxMinor: number;
  discountMinor: number;
  paidMinor: number;
  erpSyncStatus: string;
  completedAt: Date;
  payments: { status: string }[];
}): SaleSummary {
  return {
    id: sale.id,
    billNumber: sale.billNumber,
    totalMinor: sale.totalMinor,
    subtotalMinor: sale.subtotalMinor,
    taxMinor: sale.taxMinor,
    discountMinor: sale.discountMinor,
    paidMinor: sale.paidMinor,
    paymentStatus: sale.payments[0]?.status ?? "PENDING",
    erpSyncStatus: sale.erpSyncStatus,
    completedAt: sale.completedAt,
  };
}

export async function createSale(input: CreateSaleInput): Promise<CreateSaleResult> {
  // --- Idempotency fast path -------------------------------------------------------
  // Checked before any work so a retry is cheap. This is NOT the guarantee — the unique
  // constraint below is. Two simultaneous retries both miss this read; only one survives
  // the insert, and the loser is resolved by the catch at the end.
  const existing = await db.sale.findUnique({
    where: {
      tenantId_idempotencyKey: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey },
    },
    select: SALE_SELECT,
  });
  if (existing) return { status: "ok", sale: toSummary(existing), duplicate: true };

  // --- Capability ------------------------------------------------------------------
  // Selling over a counter is the RETAIL module. A tenant that has switched RETAIL off is
  // refused here, at the domain boundary, so a direct HTTP call fails exactly as a click in
  // the UI would — hiding a button is not authorization.
  //
  // Placed after the idempotency replay and before authorization, for two different reasons.
  // After the replay, because a sale that already committed is a fact: returning the receipt
  // for it is a read, and switching the module off afterwards does not un-sell it. Before
  // authorization, because "this tenant does not have this module" is the more fundamental
  // refusal — asking which cashier may ring up a sale is meaningless when the business does
  // no retail. `input.tenantId` reaches this function from the resolved session, never from
  // the request, so no caller can aim this check at another tenant.
  //
  // Every existing tenant was granted RETAIL by the P1-8F backfill and every new tenant gets
  // it at registration, so this gate changes nothing for anyone until an owner turns it off.
  const gate = await requireCapability(input.tenantId, Capability.RETAIL);
  if (gate.status !== "ok") {
    return { status: "capability_disabled", capability: gate.capability };
  }

  // --- Authorization ---------------------------------------------------------------
  // The store is looked up by id AND tenant, so a store belonging to another tenant is
  // indistinguishable from one that does not exist — no cross-tenant existence oracle.
  const store = await db.store.findFirst({
    where: { id: input.storeId, tenantId: input.tenantId },
    select: { id: true },
  });
  if (!store) return { status: "forbidden" };

  const [cashier, membership] = await Promise.all([
    db.user.findFirst({
      where: { id: input.cashierUserId, tenantId: input.tenantId },
      select: { tenantRole: true },
    }),
    db.storeMembership.findUnique({
      where: { userId_storeId: { userId: input.cashierUserId, storeId: store.id } },
      select: { role: true },
    }),
  ]);
  if (!cashier) return { status: "forbidden" };
  if (!canSell({ tenantRole: cashier.tenantRole, membershipRole: membership?.role ?? null })) {
    return { status: "forbidden" };
  }

  // --- POS shift -------------------------------------------------------------------
  // Verified here rather than trusted from the request. A client could name any session id;
  // only the server can say whether that shift is this tenant's, still open, run by this
  // cashier, and at this store.
  let posSessionId: string | null = null;
  if (input.posSessionId) {
    const resolved = await resolveSessionForSale({
      tenantId: input.tenantId,
      sessionId: input.posSessionId,
      storeId: store.id,
      cashierUserId: input.cashierUserId,
    });
    if (resolved.status === "not_found") {
      return { status: "invalid_session", reason: "That shift could not be found." };
    }
    if (resolved.status !== "ok") {
      return { status: "invalid_session", reason: resolved.reason };
    }
    posSessionId = resolved.session.id;
  }

  // --- Cart validation -------------------------------------------------------------
  if (input.lines.length === 0) return { status: "empty_cart" };
  if (input.lines.length > MAX_LINES_PER_SALE) return { status: "too_many_lines" };

  for (const line of input.lines) {
    const error = validateQuantity(line.quantity);
    if (error) return { status: "invalid_quantity", variantId: line.variantId, reason: error };
  }

  // Variants are fetched scoped to the tenant. This is what stops a sale referencing
  // another tenant's product: an unknown id and a foreign id look identical here.
  const variantIds = [...new Set(input.lines.map((l) => l.variantId))];
  const variants = await db.productVariant.findMany({
    where: { id: { in: variantIds }, tenantId: input.tenantId },
    select: {
      id: true,
      sku: true,
      priceMinor: true,
      taxRateBp: true,
      isActive: true,
      product: { select: { name: true } },
    },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));

  for (const id of variantIds) {
    const variant = byId.get(id);
    if (!variant) return { status: "unknown_variant", variantId: id };
    if (!variant.isActive) return { status: "inactive_variant", variantId: id };
  }

  if (input.customerId) {
    const customer = await db.customer.findFirst({
      where: { id: input.customerId, tenantId: input.tenantId },
      select: { id: true },
    });
    if (!customer) return { status: "unknown_customer" };
  }

  // --- Authoritative pricing -------------------------------------------------------
  // Prices and tax rates come from the variant rows just read, never from the request.
  const priced: PricedLine[] = input.lines.map((line) => {
    const variant = byId.get(line.variantId)!;
    return {
      variantId: line.variantId,
      quantity: line.quantity,
      unitPriceMinor: variant.priceMinor,
      taxRateBp: variant.taxRateBp,
    };
  });
  const totals = computeSaleTotals(priced, input.discountMinor ?? 0);

  // Unify payments
  const providedPayments = input.payments || (input.payment ? [input.payment] : []);
  if (providedPayments.length === 0) {
    return { status: "validation_error", reason: "At least one payment is required." };
  }

  let sumMinor = 0;
  const processedPayments = providedPayments.map((p) => {
    const amt = p.amountMinor ?? totals.totalMinor;
    if (amt <= 0) {
      throw new Error("Payment amounts must be positive");
    }
    sumMinor += amt;
    return { ...p, amountMinor: amt };
  });

  if (sumMinor < totals.totalMinor) {
    return { status: "validation_error", reason: "Insufficient payment." };
  }
  if (sumMinor > totals.totalMinor) {
    const hasCash = processedPayments.some(p => p.method === "CASH");
    if (!hasCash) {
      return { status: "validation_error", reason: "Overpayment requires CASH method." };
    }
  }

  const paidMinor = totals.totalMinor;

  try {
    const sale = await db.$transaction(async (tx) => {
      // Allocating the bill number first takes the Store row lock for the transaction's
      // life, so two tills cannot be issued the same number.
      const counter = await tx.store.update({
        where: { id: store.id },
        data: { nextBillSeq: { increment: 1 } },
        select: { nextBillSeq: true, code: true },
      });
      const billNumber = `${counter.code}-${String(counter.nextBillSeq - 1).padStart(6, "0")}`;

      const created = await tx.sale.create({
        data: {
          tenantId: input.tenantId,
          storeId: store.id,
          billNumber,
          cashierUserId: input.cashierUserId,
          customerId: input.customerId ?? null,
          subtotalMinor: totals.subtotalMinor,
          discountMinor: totals.discountMinor,
          taxMinor: totals.taxMinor,
          totalMinor: totals.totalMinor,
          paidMinor,
          idempotencyKey: input.idempotencyKey,
          posSessionId,
          payments: {
            create: processedPayments.map(p => ({
              method: p.method,
              status: "CONFIRMED",
              amountMinor: p.amountMinor,
              reference: p.reference?.trim() || null,
              confirmedAt: new Date(),
            })),
          },
        },
        select: SALE_SELECT,
      });

      // Lines are written as their own statement rather than nested under the sale. P1-8H made
      // `sale_items.tenantId` part of a composite foreign key, and Prisma treats a column owned
      // by a relation as not settable in a nested create — the same trade the order lines make.
      // Same transaction, so a sale still cannot exist without its lines.
      await tx.saleItem.createMany({
        data: totals.lines.map((line) => {
          const variant = byId.get(line.variantId)!;
          return {
            tenantId: input.tenantId,
            saleId: created.id,
            variantId: line.variantId,
            // Snapshots: a later price or name change must never rewrite history.
            skuSnapshot: variant.sku,
            nameSnapshot: variant.product.name,
            quantity: line.quantity,
            unitPriceMinor: line.unitPriceMinor,
            lineDiscountMinor: line.lineDiscountMinor,
            taxRateBp: line.taxRateBp,
            taxMinor: line.taxMinor,
            lineTotalMinor: line.lineTotalMinor,
          };
        }),
      });

      // Routed through the inventory ledger (P1-8B) rather than writing `stock_levels`
      // directly. The decrement itself is unchanged — same transaction, same quantity, same
      // resulting balance — but it now leaves a SALE movement behind, so the balance can
      // explain itself. Still an operational projection, NOT an ERPNext ledger posting
      // (ADR-080 / ADR-085).
      for (const line of totals.lines) {
        await applyStockMovement(tx, {
          tenantId: input.tenantId,
          storeId: store.id,
          variantId: line.variantId,
          type: "SALE",
          quantityDelta: -line.quantity,
          referenceType: "SALE",
          referenceId: created.id,
          actorUserId: input.cashierUserId,
          idempotencyKey: movementKey.sale(created.id, line.variantId),
        });
      }

      // Same transaction as the sale, so the event exists if and only if the sale does.
      await enqueueOutboxEvent(tx, {
        tenantId: input.tenantId,
        storeId: store.id,
        eventType: "SaleCompleted",
        actorUserId: input.cashierUserId,
        correlationId: input.correlationId,
        entityId: created.id,
        payload: {
          billNumber: created.billNumber,
          totalMinor: created.totalMinor,
          subtotalMinor: created.subtotalMinor,
          taxMinor: created.taxMinor,
          discountMinor: created.discountMinor,
          customerId: input.customerId ?? null,
          lineCount: totals.lines.length,
          // No card number, no UPI VPA, no operator reference — an event payload is
          // replayable and readable by every future consumer.
          paymentMethod: processedPayments.length === 1 ? processedPayments[0]?.method ?? "SPLIT" : "SPLIT",
        },
      });

      return created;
    });

    await writeAuditLog({
      tenantId: input.tenantId,
      userId: input.cashierUserId,
      action: "SaleCompleted",
      correlationId: input.correlationId,
      metadata: {
        saleId: sale.id,
        billNumber: sale.billNumber,
        storeId: store.id,
        totalMinor: sale.totalMinor,
      },
    });

    return { status: "ok", sale: toSummary(sale), duplicate: false };
  } catch (err) {
    // The real idempotency guarantee. Two concurrent retries both passed the fast-path
    // read; PostgreSQL let exactly one insert through. The loser returns the winner's sale,
    // so the operator sees one success rather than a spurious error.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002" &&
      Array.isArray(err.meta?.target) &&
      (err.meta!.target as string[]).includes("idempotencyKey")
    ) {
      const winner = await db.sale.findUnique({
        where: {
          tenantId_idempotencyKey: {
            tenantId: input.tenantId,
            idempotencyKey: input.idempotencyKey,
          },
        },
        select: SALE_SELECT,
      });
      if (winner) return { status: "ok", sale: toSummary(winner), duplicate: true };
    }
    throw err;
  }
}
