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
import { getCustomerDue } from "@/server/sales/customers";
import { STORE_SCOPE_SELECT, storeScopeOf } from "@/server/sales/storeScope";
import { getApparelSlab } from "@/server/tax/taxSettings";
import { verifyApprovalPin } from "@/server/identity/approvalPin";
import { findOrCreateCreditAccount } from "@/server/khata/creditAccount";
import { postOnAccountCreditSale } from "@/server/khata/creditSalePosting";
import { calculateInvoiceDueDate } from "@/server/khata/dueDate";
import { resolveCreditMode } from "@/server/khata/creditMode";
import { assertSellable, ReservationShortError } from "@/server/inventory/reservations";
import { onSaleCompleted } from "@/server/loyalty/loyalty";

/** A credit (udhar) sale refused inside the transaction; rolls the whole sale back. */
class CreditRefusedError extends Error {}

/** Udhar refusals a manager's PIN can overrule at the counter (owner decision 2026-10-20). */
const APPROVABLE_CREDIT_REFUSALS = new Set(["customer_phone_unverified"]);

/** Owner decisions Q5-Q10 (2026-10-14), worded for the till. */
const CREDIT_REFUSAL: Record<string, string> = {
  customer_phone_unverified:
    "This customer's phone isn't verified. Verify it with a one-time code, or an owner or store manager can approve this udhar with their PIN.",
  customer_inactive: "This customer is inactive.",
  credit_mode_blocked: "Udhar is not switched on for this customer. The owner or accountant can enable it.",
  credit_account_on_hold: "This customer's udhar is on hold.",
  credit_limit_not_configured: "This customer has no udhar limit set.",
  overdue_balance_exists: "This customer has an overdue bill. Collect it before giving more udhar; cash sales are fine.",
  credit_limit_exceeded: "This is more than the customer's remaining udhar limit.",
};

/** A cashier may discount up to 10% of the bill (owner rule 2026-10-13), in basis points. */
export const CASHIER_DISCOUNT_LIMIT_BP = 1_000;

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
  unitPriceMinor?: number;
  batchChoice?: "old" | "new";
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
  /** Owner / store manager PIN approving udhar for a customer whose phone isn't verified. */
  creditApproval?: { approverUserId: string; pin: string } | null;
  /** The seller was switched in by PIN on a shared counter; the shift may be another person's. */
  sharedCounter?: boolean;
  discountMinor?: number;
  /** Required whenever discountMinor > 0. */
  discountReason?: string | null;
  /**
   * An owner or store manager approving a cashier's discount above the cashier limit, with
   * their PIN. Verified here; the request is never trusted to have checked it.
   */
  discountApproval?: { approverUserId: string; pin: string } | null;
  payment?: SalePaymentInput;
  payments?: SalePaymentInput[];
  onAccountMinor?: number;
  correlationId: string;
}

export type CreateSaleResult =
  | { status: "forbidden" }
  | { status: "empty_cart" }
  | { status: "too_many_lines" }
  | { status: "invalid_quantity"; variantId: string; reason: string }
  | { status: "unknown_variant"; variantId: string }
  | { status: "inactive_variant"; variantId: string }
  | { status: "unresolved_tax_treatment"; variantId: string }
  | { status: "unsupported_tax_treatment"; variantId: string; taxTreatment: string }
  | { status: "unknown_customer" }
  | { status: "validation_error"; reason: string }
  | { status: "credit_facility_unavailable"; reason: string; needsApproval?: boolean }
  /** Kept for API compatibility; no longer returned now that discount rules are approved. */
  | { status: "discount_unavailable" }
  /** The discount is over the cashier's limit, or has no reason. */
  | { status: "discount_not_allowed"; reason: string }
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
  dueMinor: number;
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
  let paymentStatus: string = sale.payments[0]?.status ?? "PAID";
  if (sale.paidMinor === 0 && sale.totalMinor > 0) {
    paymentStatus = "UNPAID";
  } else if (sale.paidMinor < sale.totalMinor) {
    paymentStatus = "PARTIALLY_PAID";
  } else {
    paymentStatus = "PAID";
  }

  return {
    id: sale.id,
    billNumber: sale.billNumber,
    totalMinor: sale.totalMinor,
    subtotalMinor: sale.subtotalMinor,
    taxMinor: sale.taxMinor,
    discountMinor: sale.discountMinor,
    paidMinor: sale.paidMinor,
    dueMinor: Math.max(0, sale.totalMinor - sale.paidMinor),
    paymentStatus,
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

  // --- Discounts (owner rules 2026-10-13) -----------------------------------------------
  // Any discount needs a reason. A cashier may give up to CASHIER_DISCOUNT_LIMIT_BP of the bill;
  // more needs the person ringing the bill to be a store manager or the tenant owner. The
  // discount lowers the taxable value (see computeSaleTotals) and is stored with who
  // authorised it.
  const requestedDiscount = input.discountMinor ?? 0;
  if (!Number.isSafeInteger(requestedDiscount) || requestedDiscount < 0) {
    return { status: "validation_error", reason: "Enter a valid discount." };
  }
  const discountReason = input.discountReason?.trim() ?? "";
  if (requestedDiscount > 0 && (discountReason.length < 3 || discountReason.length > 200)) {
    return { status: "discount_not_allowed", reason: "Give a reason for the discount." };
  }

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
    select: { id: true, ...STORE_SCOPE_SELECT },
  });
  if (!store) return { status: "forbidden" };
  // Legal company and currency come only from the persisted Store, never the request. An
  // unmapped Store still sells as before; its sales simply carry no scope.
  const scope = storeScopeOf(store);

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
  const mayGiveLargeDiscount = cashier.tenantRole === "OWNER" || membership?.role === "STORE_MANAGER";

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
      sharedCounter: input.sharedCounter,
    });
    if (resolved.status === "not_found") {
      return { status: "invalid_session", reason: "That shift could not be found." };
    }
    if (resolved.status !== "ok") {
      return { status: "invalid_session", reason: resolved.reason };
    }
    posSessionId = resolved.session.id;
  } else {
    // No shift named (the quick POS screen doesn't send one): if this cashier has exactly one
    // open shift at this store, the sale belongs to it, so the shift's close count includes it.
    // None or several → left unattached, as before; never guessed.
    // Best effort: failing to find the shift must never fail the sale (Day Close still counts an
    // unattached sale by cashier, store and time).
    const open = await Promise.resolve()
      .then(() =>
        db.posSession.findMany({
          where: { tenantId: input.tenantId, storeId: store.id, cashierUserId: input.cashierUserId, closedAt: null },
          select: { id: true },
          take: 2,
        }),
      )
      .catch(() => [] as { id: string }[]);
    if (open.length === 1) posSessionId = open[0]!.id;
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
  const [variants, pendingChanges] = await Promise.all([
    db.productVariant.findMany({
      where: {
        id: { in: variantIds },
        tenantId: input.tenantId,
        product: { isDraft: false },
      },
      select: {
        id: true,
        sku: true,
        priceMinor: true,
        taxRateBp: true,
        taxRateMode: true,
        taxTreatment: true,
        isActive: true,
        product: { select: { name: true, isDraft: true } },
      },
    }),
    db.pendingPriceChange.findMany({
      where: { variantId: { in: variantIds }, tenantId: input.tenantId, status: "PENDING" },
      select: { variantId: true, newPriceMinor: true, unitsAhead: true },
    }),
  ]);
  const byId = new Map(variants.map((v) => [v.id, v]));
  const pendingByVariant = new Map<string, { newPriceMinor: number; unitsAhead: number }[]>();
  for (const pc of pendingChanges) {
    const list = pendingByVariant.get(pc.variantId) ?? [];
    list.push(pc);
    pendingByVariant.set(pc.variantId, list);
  }

  // GST types (owner B3, 2026-10-16): a bill may mix TAXABLE lines with EXEMPT, NIL_RATED,
  // ZERO_RATED and NON_GST lines, in a GST-registered business too. Only TAXABLE lines carry GST;
  // the others are priced at zero tax below. UNSPECIFIED is still refused — someone must decide.
  for (const id of variantIds) {
    const variant = byId.get(id);
    if (!variant) return { status: "unknown_variant", variantId: id };
    if (!variant.isActive) return { status: "inactive_variant", variantId: id };
    if (variant.taxTreatment === "UNSPECIFIED") {
      return { status: "unresolved_tax_treatment", variantId: id };
    }
  }

  // --- Authoritative pricing -------------------------------------------------------
  // Prices and tax rates come from the variant rows or authorized Multi-MRP batch options.
  const resolvedBatchChoices: ("old" | "new")[] = [];

  const priced: PricedLine[] = input.lines.map((line) => {
    const variant = byId.get(line.variantId)!;
    const pendingList = pendingByVariant.get(line.variantId) ?? [];
    
    // Check if the requested unitPrice matches a pending price change (New Batch)
    let unitPrice = variant.priceMinor;
    let choice: "old" | "new" = "old";

    if (line.batchChoice === "new" || (line.unitPriceMinor && pendingList.some((p) => p.newPriceMinor === line.unitPriceMinor))) {
      const match = pendingList.find((p) => p.newPriceMinor === line.unitPriceMinor) ?? pendingList[0];
      if (match) {
        unitPrice = match.newPriceMinor;
        choice = "new";
      }
    } else if (line.batchChoice === "old" || (line.unitPriceMinor && line.unitPriceMinor === variant.priceMinor)) {
      unitPrice = variant.priceMinor;
      choice = "old";
    }

    resolvedBatchChoices.push(choice);

    return {
      variantId: line.variantId,
      quantity: line.quantity,
      unitPriceMinor: unitPrice,
      // Non-taxable GST types never carry tax, whatever rate is stored on the variant.
      taxRateBp: variant.taxTreatment === "TAXABLE" ? variant.taxRateBp : 0,
      taxRateMode: variant.taxTreatment === "TAXABLE" ? variant.taxRateMode : "FIXED",
    };
  });
  const slab = priced.some((l) => l.taxRateMode === "APPAREL_SLAB") ? await getApparelSlab(input.tenantId) : null;
  const grossMinor = priced.reduce((sum, l) => sum + l.unitPriceMinor * l.quantity, 0);
  if (requestedDiscount > grossMinor) {
    return { status: "validation_error", reason: "The discount cannot be more than the bill." };
  }
  let discountAuthoriser = input.cashierUserId;
  if (requestedDiscount * 10_000 > grossMinor * CASHIER_DISCOUNT_LIMIT_BP && !mayGiveLargeDiscount) {
    const approval = input.discountApproval;
    if (!approval?.approverUserId || !approval.pin) {
      return {
        status: "discount_not_allowed",
        reason: `Discounts above ${CASHIER_DISCOUNT_LIMIT_BP / 100}% need a store manager or owner to approve with their PIN.`,
      };
    }
    const verdict = await verifyApprovalPin({
      tenantId: input.tenantId,
      storeId: store.id,
      approverUserId: approval.approverUserId,
      pin: approval.pin,
    });
    if (verdict.status === "locked") {
      return { status: "discount_not_allowed", reason: "That approver's PIN is locked after too many wrong tries. Try again in 15 minutes." };
    }
    if (verdict.status === "wrong_pin") {
      return {
        status: "discount_not_allowed",
        reason: `Wrong PIN. ${verdict.attemptsLeft} ${verdict.attemptsLeft === 1 ? "try" : "tries"} left before it locks.`,
      };
    }
    if (verdict.status !== "ok") {
      return { status: "discount_not_allowed", reason: "That person can't approve discounts in this store." };
    }
    discountAuthoriser = approval.approverUserId;
  }
  const totals = computeSaleTotals(priced, requestedDiscount, slab);

  // --- Khata / Udhar (on-account) validation ---------------------------------------
  const onAccountMinor = input.onAccountMinor ?? 0;
  if (!Number.isInteger(onAccountMinor) || onAccountMinor < 0) {
    return { status: "validation_error", reason: "Enter a valid udhar amount." };
  }
  if (onAccountMinor > totals.totalMinor) {
    return { status: "validation_error", reason: "Udhar cannot be more than the bill total." };
  }

  if (onAccountMinor > 0) {
    if (!input.customerId) {
      return { status: "validation_error", reason: "Add the customer to give udhar." };
    }

    // Q5 (owner 2026-10-14): credit is enabled for approved accounts only, and only where the store
    // belongs to a legal Company — exposure is Company-scoped and never crosses Companies.
    if (!scope) {
      return {
        status: "credit_facility_unavailable",
        reason: "This store isn't linked to a company, so it can't give udhar.",
      };
    }
  }

  // A manager's PIN can approve udhar for a customer whose phone isn't verified. Checked here,
  // before anything is written; a wrong or locked PIN refuses the bill with the reason.
  let creditApprover: string | null = null;
  if (onAccountMinor > 0 && input.creditApproval?.approverUserId && input.creditApproval.pin) {
    const verdict = await verifyApprovalPin({
      tenantId: input.tenantId,
      storeId: store.id,
      approverUserId: input.creditApproval.approverUserId,
      pin: input.creditApproval.pin,
    });
    if (verdict.status === "locked") {
      return {
        status: "credit_facility_unavailable",
        reason: "That approver's PIN is locked after too many wrong tries. Try again in 15 minutes.",
        needsApproval: true,
      };
    }
    if (verdict.status === "wrong_pin") {
      return {
        status: "credit_facility_unavailable",
        reason: `Wrong PIN. ${verdict.attemptsLeft} ${verdict.attemptsLeft === 1 ? "try" : "tries"} left.`,
        needsApproval: true,
      };
    }
    if (verdict.status !== "ok") {
      return { status: "credit_facility_unavailable", reason: "Only an owner or store manager with a PIN can approve udhar.", needsApproval: true };
    }
    creditApprover = input.creditApproval.approverUserId;
  }

  // Unify payments
  const providedPayments = input.payments || (input.payment ? [input.payment] : []);
  const requiredPayment = totals.totalMinor - onAccountMinor;

  if (requiredPayment > 0 && providedPayments.length === 0) {
    return { status: "validation_error", reason: "At least one payment is required." };
  }

  let sumMinor = 0;
  const processedPayments = providedPayments.map((p) => {
    const amt = p.amountMinor ?? requiredPayment;
    if (amt <= 0) {
      throw new Error("Payment amounts must be positive");
    }
    sumMinor += amt;
    return { ...p, amountMinor: amt };
  });

  if (sumMinor < requiredPayment) {
    return { status: "validation_error", reason: "Insufficient payment." };
  }

  // Exact settlement equation for on-account sales:
  // Actual tenders collected plus onAccountMinor must exactly equal totalMinor.
  if (onAccountMinor > 0 && sumMinor !== requiredPayment) {
    return {
      status: "validation_error",
      reason: "Tender amounts plus udhar amount must exactly equal the bill total.",
    };
  }

  if (sumMinor > requiredPayment) {
    const hasCash = processedPayments.some((p) => p.method === "CASH");
    if (!hasCash) {
      return { status: "validation_error", reason: "Overpayment requires CASH method." };
    }
  }

  const paidMinor = requiredPayment;

  try {
    const sale = await db.$transaction(async (tx) => {
      // Re-verify customer eligibility and available credit inside the transaction with locking.
      if (input.customerId) {
        // SELECT FOR UPDATE locks the customer row across tills to serialize concurrent credit consumption.
        const lockedCustomers = await tx.$queryRaw<
          { id: string; phone: string | null; creditLimitMinor: number | null; isActive: boolean }[]
        >`
          SELECT "id", "phone", "creditLimitMinor", "isActive"
            FROM "customers"
           WHERE "id" = ${input.customerId}
             AND "tenantId" = ${input.tenantId}
             FOR UPDATE
        `;
        const customerRecord = lockedCustomers[0];
        if (!customerRecord || !customerRecord.isActive) {
          throw new Error("CUSTOMER_UNKNOWN_OR_INACTIVE");
        }

        if (onAccountMinor > 0) {
          if (!customerRecord.phone || !customerRecord.phone.trim()) {
            throw new Error("CUSTOMER_MISSING_MOBILE");
          }
          // Q5/Q10: an explicitly enabled account with an authorised FINITE limit. A new account starts
          // BLOCKED (Rs 0); UNLIMITED is not allowed at the till. The ledger posting below re-checks
          // phone verification, hold, overdue bills and the remaining limit under the account lock.
          const account = await findOrCreateCreditAccount(tx, {
            tenantId: input.tenantId,
            companyId: scope!.companyId,
            customerId: customerRecord.id,
          });
          const mode = resolveCreditMode({ mode: account.creditMode, limitMinor: account.creditModeLimitMinor });
          if (mode.mode === "BLOCKED") throw new CreditRefusedError("credit_mode_blocked");
          if (mode.mode !== "LIMITED" || !mode.limitMinor || mode.limitMinor <= 0) {
            throw new CreditRefusedError("credit_limit_not_configured");
          }
        }
      }

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
          companyId: scope?.companyId ?? null,
          currencySnapshot: scope?.currency ?? null,
          billNumber,
          cashierUserId: input.cashierUserId,
          customerId: input.customerId ?? null,
          subtotalMinor: totals.subtotalMinor,
          discountMinor: totals.discountMinor,
          discountReason: totals.discountMinor > 0 ? discountReason : null,
          discountAuthorisedByUserId: totals.discountMinor > 0 ? discountAuthoriser : null,
          taxMinor: totals.taxMinor,
          totalMinor: totals.totalMinor,
          paidMinor,
          initialOnAccountMinor: onAccountMinor,
          // Due-date snapshots for udhar bills: the customer's terms, else the Company's default.
          ...(onAccountMinor > 0 ? await creditTermsSnapshot(tx, input.tenantId, scope!.companyId, input.customerId!) : {}),
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

      // Decision 41: loyalty earn, inert until finance + GST sign-off (LOYALTY_SIGNOFF).
      await onSaleCompleted(tx, {
        tenantId: input.tenantId,
        id: created.id,
        customerId: input.customerId ?? null,
        currency: scope?.currency ?? null,
        totalMinor: totals.totalMinor,
        taxMinor: totals.taxMinor,
        onAccountMinor,
      });

      // Lines are written as their own statement rather than nested under the sale. P1-8H made
      // `sale_items.tenantId` part of a composite foreign key, and Prisma treats a column owned
      // by a relation as not settable in a nested create — the same trade the order lines make.
      // Same transaction, so a sale still cannot exist without its lines.
      // The cost of each line is the store's weighted average at the moment of sale, read inside
      // this transaction. A variant with no recorded cost stays null and is left out of profit.
      const costLevels = await tx.stockLevel.findMany({
        where: { storeId: store.id, variantId: { in: totals.lines.map((l) => l.variantId) } },
        select: { variantId: true, avgCostMinor: true },
      });
      const costByVariant = new Map(costLevels.map((c) => [c.variantId, c.avgCostMinor]));

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
            taxTreatment: variant.taxTreatment,
            unitCostMinor: costByVariant.get(line.variantId) ?? null,
          };
        }),
      });

      // Routed through the inventory ledger (P1-8B) rather than writing `stock_levels`
      // directly. The decrement itself is unchanged — same transaction, same quantity, same
      // resulting balance — but it now leaves a SALE movement behind, so the balance can
      // explain itself. Still an operational projection, NOT an ERPNext ledger posting
      // (ADR-080 / ADR-085).
      for (let idx = 0; idx < totals.lines.length; idx++) {
        const line = totals.lines[idx]!;
        const batchChoice = resolvedBatchChoices[idx] ?? "old";
        // Decision 36: units reserved for a confirmed order or a live checkout can't be sold here.
        await assertSellable(tx, { tenantId: input.tenantId, storeId: store.id, variantId: line.variantId, quantity: line.quantity });
        await applyStockMovement(tx, {
          tenantId: input.tenantId,
          storeId: store.id,
          variantId: line.variantId,
          type: "SALE",
          quantityDelta: -line.quantity,
          referenceType: "SALE",
          referenceId: created.id,
          actorUserId: input.cashierUserId,
          idempotencyKey: movementKey.sale(created.id, `${line.variantId}-${idx}`),
          batchChoice,
        });
      }

      // Udhar goes onto the Company-scoped Khata ledger in the same transaction, or the sale doesn't
      // happen at all (owner decisions Q5, Q8, Q9, Q10).
      if (onAccountMinor > 0) {
        const posted = await postOnAccountCreditSale(tx, {
          tenantId: input.tenantId,
          saleId: created.id,
          actorUserId: input.cashierUserId,
          idempotencyKey: `credit-sale:${created.id}`,
          allowOverdue: true,
          phoneCheckApprovedBy: creditApprover,
        });
        if (posted.status !== "success") throw new CreditRefusedError(posted.code);
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
          paymentMethod:
            processedPayments.length === 1 && onAccountMinor === 0
              ? processedPayments[0]?.method ?? "SPLIT"
              : processedPayments.length === 0
                ? null
                : "SPLIT",
          onAccountMinor,
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
        ...(sale.discountMinor > 0
          ? { discountMinor: sale.discountMinor, discountReason, discountAuthorisedByUserId: discountAuthoriser }
          : {}),
        // Udhar given to a customer whose phone isn't verified, on this person's PIN.
        ...(creditApprover ? { udharApprovedByUserId: creditApprover, udharApprovalReason: "phone not verified" } : {}),
      },
    });

    return { status: "ok", sale: toSummary(sale), duplicate: false };
  } catch (err) {
    if (err instanceof ReservationShortError) {
      return {
        status: "validation_error",
        reason: `Only ${err.available} of that item can be sold; the rest is reserved for an order.`,
      };
    }
    if (err instanceof CreditRefusedError) {
      return {
        status: "credit_facility_unavailable",
        reason: CREDIT_REFUSAL[err.message] ?? "Udhar can't be given for this bill.",
        ...(APPROVABLE_CREDIT_REFUSALS.has(err.message) ? { needsApproval: true } : {}),
      };
    }
    if (err instanceof Error) {
      if (err.message === "CUSTOMER_UNKNOWN_OR_INACTIVE") {
        return { status: "unknown_customer" };
      }
      if (err.message === "CUSTOMER_MISSING_MOBILE") {
        return {
          status: "validation_error",
          reason: "This customer has no mobile number. Add one before giving udhar.",
        };
      }
      if (err.message === "CUSTOMER_OVER_UDHAR_LIMIT") {
        return { status: "validation_error", reason: "Over the customer's udhar limit." };
      }
    }

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

/** The due date an udhar bill is created with: the customer's own terms, else the Company default. */
async function creditTermsSnapshot(tx: Prisma.TransactionClient, tenantId: string, companyId: string, customerId: string) {
  const [customer, company] = await Promise.all([
    tx.customer.findFirst({ where: { id: customerId, tenantId }, select: { paymentTermsDays: true } }),
    tx.company.findUnique({ where: { id_tenantId: { id: companyId, tenantId } }, select: { defaultPaymentTermsDays: true } }),
  ]);
  const due = calculateInvoiceDueDate({
    completedAt: new Date(),
    customerPaymentTermsDays: customer?.paymentTermsDays ?? null,
    companyDefaultTermsDays: company?.defaultPaymentTermsDays ?? null,
  });
  return { effectiveTermsDaysSnapshot: due.effectiveTermsDays, dueDateSnapshot: due.dueDate };
}
