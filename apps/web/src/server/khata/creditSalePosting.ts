import type { Prisma } from "@prisma/client";
import { resolveCreditMode } from "./creditMode";

/**
 * The account's credit mode is the authority for whether udhar is allowed and how much.
 * - BLOCKED, missing or invalid: refused.
 * - UNLIMITED: no monetary limit; the legacy `creditEnabled` flag and `creditLimitMinor` are ignored.
 * - LIMITED: `creditModeLimitMinor` (validated positive integer minor units) is the only limit.
 * Scope, credit hold, overdue and phone-verification checks stay independent and in force.
 */
function effectiveCreditMode(account: { creditMode?: unknown; creditModeLimitMinor?: unknown }) {
  return resolveCreditMode({ mode: account.creditMode, limitMinor: account.creditModeLimitMinor });
}

/** Remaining headroom under a LIMITED mode; null means no monetary limit (UNLIMITED). */
function availableUnder(limitMinor: number | null, exposureMinor: number): number | null {
  if (limitMinor === null) return null;
  const raw = limitMinor - exposureMinor;
  return raw > 0 ? raw : 0;
}

/**
 * Result types for postOnAccountCreditSale operation
 */
export type PostOnAccountCreditSaleResult =
  | {
      status: "success";
      receivableEntryId: string;
      idempotentReplay: boolean;
      currentReceivableMinor: number;
      /** Remaining credit under a LIMITED mode; null when the mode is UNLIMITED. */
      availableCreditMinor: number | null;
      originalPostedAmountMinor?: number;
    }
  | {
      status: "rejected";
      code:
        | "sale_not_found"
        | "sale_not_completed"
        | "sale_missing_scope"
        | "sale_store_scope_mismatch"
        | "sale_has_no_receivable"
        | "customer_not_found"
        | "customer_inactive"
        | "customer_phone_unverified"
        | "credit_account_not_found"
        | "credit_account_disabled"
        | "credit_mode_blocked"
        | "credit_account_on_hold"
        | "credit_limit_not_configured"
        | "overdue_balance_exists"
        | "credit_limit_exceeded"
        | "idempotency_conflict"
        | "inconsistent_ledger_state";
      reason: string;
    };

export interface PostOnAccountCreditSaleInput {
  tenantId: string;
  saleId: string;
  actorUserId: string;
  idempotencyKey: string;
  notes?: string;
  /** When true, allows counter continuous Udhar without blocking on overdue invoices */
  allowOverdue?: boolean;
  /**
   * An owner or store manager approved this udhar with their PIN although the customer's phone is
   * not verified (owner decision 2026-10-20: never block outright). Verified by the caller.
   */
  phoneCheckApprovedBy?: string | null;
}

/**
 * Inspects Prisma P2002 metadata to determine if the unique violation targets
 * the exact tenantId + idempotencyKey unique constraint for KhataReceivableEntry.
 *
 * For schema constraint: @@unique([tenantId, idempotencyKey])
 * - Array format reported by Prisma: ["tenantId", "idempotencyKey"]
 * - Compound target name reported by Prisma: "tenantId_idempotencyKey"
 * - Raw database constraint name: "khata_receivable_entries_tenantId_idempotencyKey_key"
 *
 * NOTE: There is no one-posting-per-sale unique constraint on khata_receivable_entries
 * in schema or migrations (saleId has a non-unique index to support repayments, returns,
 * and allocations). Sale uniqueness is serialized in application code via row lock.
 * Every other P2002 violation (including saleId or unrelated composite targets)
 * is rejected by this predicate and re-thrown unchanged.
 */
function isKnownIdempotencyConflict(target: unknown): boolean {
  if (Array.isArray(target)) {
    return (
      (target.length === 2 &&
        target.includes("tenantId") &&
        target.includes("idempotencyKey")) ||
      (target.length === 1 &&
        (target[0] === "tenantId_idempotencyKey" ||
          target[0] === "khata_receivable_entries_tenantId_idempotencyKey_key"))
    );
  }
  if (typeof target === "string") {
    return (
      target === "tenantId_idempotencyKey" ||
      target === "khata_receivable_entries_tenantId_idempotencyKey_key"
    );
  }
  return false;
}

/**
 * Validates eligibility and posts an on-account credit sale to the authoritative Khata ledger.
 *
 * CRITICAL TRANSACTION CONTRACT:
 * The `tx` argument MUST be an active Prisma interactive transaction client
 * (i.e., created via `prisma.$transaction(async (tx) => ...)`).
 * Calling this function with the root PrismaClient will throw an error at runtime,
 * because `SELECT ... FOR UPDATE` row locks degrade to autocommit single-statement scope
 * outside of an interactive transaction block.
 *
 * NOTE: Application-level row locks and code contracts do NOT prevent direct SQL/table
 * modifications. Database role least-privilege enforcement remains an explicit release blocker.
 */
export async function postOnAccountCreditSale(
  tx: Prisma.TransactionClient,
  input: PostOnAccountCreditSaleInput
): Promise<PostOnAccountCreditSaleResult> {
  // Runtime enforcement: reject root PrismaClient instances
  if ("$transaction" in tx && typeof (tx as any).$transaction === "function") {
    throw new Error(
      "postOnAccountCreditSale requires an interactive transaction (tx: Prisma.TransactionClient); root PrismaClient was provided"
    );
  }

  const { tenantId, saleId, actorUserId, idempotencyKey, notes } = input;

  if (!idempotencyKey || idempotencyKey.trim() === "") {
    return {
      status: "rejected",
      code: "idempotency_conflict",
      reason: "An idempotency key is required to post on-account credit sale",
    };
  }

  // 1. Fetch Sale with Store and Customer relations
  const sale = await tx.sale.findUnique({
    where: { id_tenantId: { id: saleId, tenantId } },
    include: {
      store: true,
      customer: true,
    },
  });

  if (!sale) {
    return {
      status: "rejected",
      code: "sale_not_found",
      reason: `Sale ${saleId} does not exist in tenant ${tenantId}`,
    };
  }

  if (sale.status !== "COMPLETED") {
    return {
      status: "rejected",
      code: "sale_not_completed",
      reason: `Sale ${saleId} is not in COMPLETED status (status is ${sale.status})`,
    };
  }

  // Verify Sale scope (must not be legacy unmapped sale)
  if (!sale.companyId || !sale.currencySnapshot) {
    return {
      status: "rejected",
      code: "sale_missing_scope",
      reason: `Sale ${saleId} is missing an explicit companyId or currencySnapshot`,
    };
  }

  // Verify Store scope alignment
  if (sale.store.companyId !== sale.companyId || sale.store.currency !== sale.currencySnapshot) {
    return {
      status: "rejected",
      code: "sale_store_scope_mismatch",
      reason: `Sale scope (${sale.companyId}, ${sale.currencySnapshot}) does not match store scope (${sale.store.companyId}, ${sale.store.currency})`,
    };
  }

  // Verify due date / terms snapshots
  if (sale.effectiveTermsDaysSnapshot === null || sale.dueDateSnapshot === null) {
    return {
      status: "rejected",
      code: "sale_missing_scope",
      reason: `Sale ${saleId} lacks an authoritative effectiveTermsDaysSnapshot or dueDateSnapshot`,
    };
  }

  // Authoritative amount strictly derived from persisted sale
  const amountMinor = sale.initialOnAccountMinor;
  if (amountMinor <= 0) {
    return {
      status: "rejected",
      code: "sale_has_no_receivable",
      reason: `Sale ${saleId} has no on-account balance (initialOnAccountMinor is ${amountMinor})`,
    };
  }

  if (!Number.isSafeInteger(amountMinor)) {
    return {
      status: "rejected",
      code: "inconsistent_ledger_state",
      reason: `Sale ${saleId} amount exceeds safe integer range`,
    };
  }

  // Verify Customer eligibility
  if (!sale.customer || !sale.customerId) {
    return {
      status: "rejected",
      code: "customer_not_found",
      reason: `Sale ${saleId} has no identified customer`,
    };
  }

  if (!sale.customer.isActive) {
    return {
      status: "rejected",
      code: "customer_inactive",
      reason: `Customer ${sale.customerId} is inactive`,
    };
  }

  if (!sale.customer.phoneVerifiedAt && !input.phoneCheckApprovedBy) {
    return {
      status: "rejected",
      code: "customer_phone_unverified",
      reason: `Customer ${sale.customerId} does not have a verified phone number`,
    };
  }

  // Check existing receivable entry by idempotency key
  const existingByIdempotency = await tx.khataReceivableEntry.findUnique({
    where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
  });

  if (existingByIdempotency) {
    // Verify that the existing row is strictly the original DEBIT_CREDIT_SALE for the exact sale, full scope, amount, and non-conflicting linkage
    const isExactDebitSalePosting =
      existingByIdempotency.entryType === "DEBIT_CREDIT_SALE" &&
      existingByIdempotency.tenantId === tenantId &&
      existingByIdempotency.companyId === sale.companyId &&
      existingByIdempotency.customerId === sale.customerId &&
      existingByIdempotency.currency === sale.currencySnapshot &&
      existingByIdempotency.saleId === saleId &&
      existingByIdempotency.amountMinor === amountMinor &&
      Boolean(existingByIdempotency.creditAccountId) &&
      (existingByIdempotency.paymentAllocationId === null || existingByIdempotency.paymentAllocationId === undefined) &&
      (existingByIdempotency.allocationId === null || existingByIdempotency.allocationId === undefined) &&
      (existingByIdempotency.saleReturnId === null || existingByIdempotency.saleReturnId === undefined) &&
      (existingByIdempotency.reversalOfId === null || existingByIdempotency.reversalOfId === undefined) &&
      (existingByIdempotency.reversalOfTenantId === null || existingByIdempotency.reversalOfTenantId === undefined) &&
      (existingByIdempotency.reversalOfCompanyId === null || existingByIdempotency.reversalOfCompanyId === undefined) &&
      (existingByIdempotency.reversalOfCustomerId === null || existingByIdempotency.reversalOfCustomerId === undefined) &&
      (existingByIdempotency.reversalOfAccountId === null || existingByIdempotency.reversalOfAccountId === undefined) &&
      (existingByIdempotency.reversalOfCurrency === null || existingByIdempotency.reversalOfCurrency === undefined);

    if (isExactDebitSalePosting) {
      // Replay path: fetch credit account and strictly validate scope and status
      const replayAccount = await tx.customerCreditAccount.findUnique({
        where: { id: existingByIdempotency.creditAccountId },
      });

      if (!replayAccount) {
        return {
          status: "rejected",
          code: "credit_account_not_found",
          reason: `Credit account ${existingByIdempotency.creditAccountId} not found on idempotent replay`,
        };
      }

      if (
        replayAccount.tenantId !== tenantId ||
        replayAccount.companyId !== sale.companyId ||
        replayAccount.customerId !== sale.customerId ||
        replayAccount.currency !== sale.currencySnapshot
      ) {
        return {
          status: "rejected",
          code: "credit_account_not_found",
          reason: `Credit account scope mismatch on idempotent replay`,
        };
      }

      const replayMode = effectiveCreditMode(replayAccount);
      if (replayMode.mode === "BLOCKED") {
        return {
          status: "rejected",
          code: "credit_mode_blocked",
          reason: `Credit account ${replayAccount.id} credit mode does not allow udhar`,
        };
      }

      if (replayAccount.creditHold) {
        return {
          status: "rejected",
          code: "credit_account_on_hold",
          reason: `Credit account ${replayAccount.id} is on administrative hold`,
        };
      }

      // Query current ledger sums for the replay account
      const replaySums = await tx.$queryRaw<
        {
          debitSum: bigint | null;
          creditSum: bigint | null;
        }[]
      >`
        SELECT
          SUM(CASE WHEN "entryType" IN ('DEBIT_CREDIT_SALE', 'DEBIT_REVERSAL') THEN "amountMinor" ELSE 0 END) AS "debitSum",
          SUM(CASE WHEN "entryType" IN ('CREDIT_REPAYMENT', 'CREDIT_SALE_RETURN', 'CREDIT_ADVANCE_APPLY', 'CREDIT_REVERSAL') THEN "amountMinor" ELSE 0 END) AS "creditSum"
        FROM "khata_receivable_entries"
        WHERE "tenantId" = ${tenantId}
          AND "companyId" = ${sale.companyId}
          AND "customerId" = ${sale.customerId}
          AND "creditAccountId" = ${replayAccount.id}
          AND "currency" = ${sale.currencySnapshot}
      `;

      const rawReplayDebits = replaySums[0]?.debitSum ?? 0n;
      const rawReplayCredits = replaySums[0]?.creditSum ?? 0n;

      if (
        rawReplayDebits > BigInt(Number.MAX_SAFE_INTEGER) ||
        rawReplayCredits > BigInt(Number.MAX_SAFE_INTEGER) ||
        rawReplayDebits < 0n ||
        rawReplayCredits < 0n
      ) {
        return {
          status: "rejected",
          code: "inconsistent_ledger_state",
          reason: `Receivable ledger balance on replay exceeds safe integer bounds`,
        };
      }

      const replayDebits = Number(rawReplayDebits);
      const replayCredits = Number(rawReplayCredits);

      // Inconsistent ledger: fail closed
      if (replayCredits > replayDebits) {
        return {
          status: "rejected",
          code: "inconsistent_ledger_state",
          reason: `Receivable ledger for account ${replayAccount.id} is in an inconsistent state on replay: credits (${replayCredits}) exceed debits (${replayDebits})`,
        };
      }

      const replayCurrentReceivable = replayDebits - replayCredits;

      if (!Number.isSafeInteger(replayCurrentReceivable) || replayCurrentReceivable < 0) {
        return {
          status: "rejected",
          code: "inconsistent_ledger_state",
          reason: `Computed current receivable on replay is not a safe non-negative integer`,
        };
      }

      const replayAvailableCredit = availableUnder(replayMode.limitMinor, replayCurrentReceivable);

      if (replayAvailableCredit !== null && (!Number.isSafeInteger(replayAvailableCredit) || replayAvailableCredit < 0)) {
        return {
          status: "rejected",
          code: "inconsistent_ledger_state",
          reason: `Computed available credit on replay is not a safe non-negative integer`,
        };
      }

      return {
        status: "success",
        receivableEntryId: existingByIdempotency.id,
        idempotentReplay: true,
        currentReceivableMinor: replayCurrentReceivable,
        availableCreditMinor: replayAvailableCredit,
        originalPostedAmountMinor: existingByIdempotency.amountMinor,
      };
    }

    // Conflicting reuse of idempotency key
    return {
      status: "rejected",
      code: "idempotency_conflict",
      reason: `Idempotency key ${idempotencyKey} has already been used for a different entry, type, scope, or linkage`,
    };
  }

  // Pre-lock check: Check if a receivable entry has ALREADY been posted for this sale
  const existingSaleEntry = await tx.khataReceivableEntry.findFirst({
    where: {
      tenantId,
      saleId,
      entryType: "DEBIT_CREDIT_SALE",
    },
  });

  if (existingSaleEntry) {
    return {
      status: "rejected",
      code: "idempotency_conflict",
      reason: `Sale ${saleId} has already been posted to Khata receivable ledger (entry ${existingSaleEntry.id})`,
    };
  }

  // 2. Lock the CustomerCreditAccount row for update (serialize postings under this credit account)
  const lockedAccounts = await tx.$queryRaw<
    {
      id: string;
      tenantId: string;
      companyId: string;
      customerId: string;
      currency: string;
      creditLimitMinor: number | null;
      creditEnabled: boolean;
      creditHold: boolean;
      creditMode: string | null;
      creditModeLimitMinor: number | null;
    }[]
  >`
    SELECT "id", "tenantId", "companyId", "customerId", "currency", "creditLimitMinor", "creditEnabled", "creditHold",
           "creditMode"::text AS "creditMode", "creditModeLimitMinor"
    FROM "customer_credit_accounts"
    WHERE "tenantId" = ${tenantId}
      AND "companyId" = ${sale.companyId}
      AND "customerId" = ${sale.customerId}
      AND "currency" = ${sale.currencySnapshot}
    FOR UPDATE
  `;

  const account = lockedAccounts[0];
  if (!account) {
    return {
      status: "rejected",
      code: "credit_account_not_found",
      reason: `No credit account found for customer ${sale.customerId} under company ${sale.companyId} and currency ${sale.currencySnapshot}`,
    };
  }

  const mode = effectiveCreditMode(account);
  if (mode.mode === "BLOCKED") {
    return {
      status: "rejected",
      code: "credit_mode_blocked",
      reason: `Credit account ${account.id} credit mode does not allow udhar`,
    };
  }

  if (account.creditHold) {
    return {
      status: "rejected",
      code: "credit_account_on_hold",
      reason: `Credit account ${account.id} is on administrative hold`,
    };
  }

  // In-lock re-check: Guard against concurrent requests posting the same sale under different keys
  const concurrentSaleEntry = await tx.khataReceivableEntry.findFirst({
    where: {
      tenantId,
      saleId,
      entryType: "DEBIT_CREDIT_SALE",
    },
  });

  if (concurrentSaleEntry) {
    return {
      status: "rejected",
      code: "idempotency_conflict",
      reason: `Sale ${saleId} has already been posted to Khata receivable ledger (entry ${concurrentSaleEntry.id})`,
    };
  }

  // 3. Compute authoritative balance and check overdue invoices
  // A. Outstanding receivable balance = sum(DEBIT) - sum(CREDIT)
  const receivableSums = await tx.$queryRaw<
    {
      debitSum: bigint | null;
      creditSum: bigint | null;
    }[]
  >`
    SELECT
      SUM(CASE WHEN "entryType" IN ('DEBIT_CREDIT_SALE', 'DEBIT_REVERSAL') THEN "amountMinor" ELSE 0 END) AS "debitSum",
      SUM(CASE WHEN "entryType" IN ('CREDIT_REPAYMENT', 'CREDIT_SALE_RETURN', 'CREDIT_ADVANCE_APPLY', 'CREDIT_REVERSAL') THEN "amountMinor" ELSE 0 END) AS "creditSum"
    FROM "khata_receivable_entries"
    WHERE "tenantId" = ${tenantId}
      AND "companyId" = ${sale.companyId}
      AND "customerId" = ${sale.customerId}
      AND "creditAccountId" = ${account.id}
      AND "currency" = ${sale.currencySnapshot}
  `;

  const rawDebits = receivableSums[0]?.debitSum ?? 0n;
  const rawCredits = receivableSums[0]?.creditSum ?? 0n;

  // Defensive bounds checks on sums
  if (
    rawDebits > BigInt(Number.MAX_SAFE_INTEGER) ||
    rawCredits > BigInt(Number.MAX_SAFE_INTEGER) ||
    rawDebits < 0n ||
    rawCredits < 0n
  ) {
    return {
      status: "rejected",
      code: "inconsistent_ledger_state",
      reason: `Receivable ledger balance for account ${account.id} exceeds safe integer bounds`,
    };
  }

  const totalDebits = Number(rawDebits);
  const totalCredits = Number(rawCredits);

  // Invariant: In an authoritative asset ledger, total credits must never exceed total debits.
  // Never clamp negative balances silently to zero; fail closed.
  if (totalCredits > totalDebits) {
    return {
      status: "rejected",
      code: "inconsistent_ledger_state",
      reason: `Receivable ledger for account ${account.id} is in an inconsistent state: credits (${totalCredits}) exceed debits (${totalDebits})`,
    };
  }

  const currentReceivableMinor = totalDebits - totalCredits;

  if (!Number.isSafeInteger(currentReceivableMinor) || currentReceivableMinor < 0) {
    return {
      status: "rejected",
      code: "inconsistent_ledger_state",
      reason: `Computed current receivable balance is not a safe non-negative integer`,
    };
  }

  // B. Check for overdue balance from past due sales.
  // Authoritative calculation:
  // - Computes net outstanding balance per sale using khata_receivable_entries (accounting for
  //   sales, repayments, advance applications, sale returns, and reversals).
  // - Uses isolated scalar subqueries as fallback for any sales without receivable entries.
  // - Does NOT silently omit legacy/unmapped sales (where companyId or currencySnapshot is NULL).
  // - Eliminates multi-table LEFT JOIN Cartesian product multiplication.
  // Overdue means the due DATE has passed: a bill due today is not overdue until tomorrow (India
  // business day). And the bill being posted right now can never be overdue against itself.
  if (!input.allowOverdue) {
    const nowIst = new Date(Date.now() + 330 * 60_000);
    const now = new Date(`${nowIst.toISOString().slice(0, 10)}T00:00:00+05:30`);
    const overdueSales = await tx.$queryRaw<
      {
        saleId: string;
        initialOnAccountMinor: number;
        outstandingMinor: number;
      }[]
    >`
      WITH sale_receivable_ledger AS (
        SELECT
          "saleId",
          SUM(CASE WHEN "entryType" IN ('DEBIT_CREDIT_SALE', 'DEBIT_REVERSAL') THEN "amountMinor" ELSE 0 END) AS "debits",
          SUM(CASE WHEN "entryType" IN ('CREDIT_REPAYMENT', 'CREDIT_SALE_RETURN', 'CREDIT_ADVANCE_APPLY', 'CREDIT_REVERSAL') THEN "amountMinor" ELSE 0 END) AS "credits"
        FROM "khata_receivable_entries"
        WHERE "tenantId" = ${tenantId}
          AND "customerId" = ${sale.customerId}
          AND "saleId" IS NOT NULL
        GROUP BY "saleId"
      ),
      sale_allocations_fallback AS (
        SELECT
          s."id" AS "saleId",
          COALESCE((
            SELECT SUM(kpa."amountMinor")
            FROM "khata_payment_allocations" kpa
            WHERE kpa."saleId" = s."id" AND kpa."tenantId" = s."tenantId"
          ), 0) +
          COALESCE((
            SELECT SUM(kaa."amountMinor")
            FROM "khata_advance_allocations" kaa
            WHERE kaa."saleId" = s."id" AND kaa."tenantId" = s."tenantId"
          ), 0) +
          COALESCE((
            SELECT SUM(sr."totalRefundMinor")
            FROM "sale_returns" sr
            WHERE sr."originalSaleId" = s."id" AND sr."tenantId" = s."tenantId" AND sr."status" = 'COMPLETED'
          ), 0) AS "fallbackCredits"
        FROM "sales" s
        WHERE s."tenantId" = ${tenantId}
          AND s."customerId" = ${sale.customerId}
          AND (s."companyId" = ${sale.companyId} OR s."companyId" IS NULL)
          AND (s."currencySnapshot" = ${sale.currencySnapshot} OR s."currencySnapshot" IS NULL)
          AND s."dueDateSnapshot" IS NOT NULL
          AND s."dueDateSnapshot" < ${now}
          AND s."initialOnAccountMinor" > 0
          AND s."id" <> ${saleId}
      )
      SELECT
        s."id" AS "saleId",
        s."initialOnAccountMinor",
        CASE
          WHEN srl."saleId" IS NOT NULL THEN (srl."debits" - srl."credits")
          ELSE (s."initialOnAccountMinor" - saf."fallbackCredits")
        END AS "outstandingMinor"
      FROM "sales" s
      LEFT JOIN sale_receivable_ledger srl ON srl."saleId" = s."id"
      LEFT JOIN sale_allocations_fallback saf ON saf."saleId" = s."id"
      WHERE s."tenantId" = ${tenantId}
        AND s."customerId" = ${sale.customerId}
        AND (s."companyId" = ${sale.companyId} OR s."companyId" IS NULL)
        AND (s."currencySnapshot" = ${sale.currencySnapshot} OR s."currencySnapshot" IS NULL)
        AND s."dueDateSnapshot" IS NOT NULL
        AND s."dueDateSnapshot" < ${now}
        AND s."initialOnAccountMinor" > 0
        AND s."id" <> ${saleId}
        AND (
          CASE
            WHEN srl."saleId" IS NOT NULL THEN (srl."debits" - srl."credits")
            ELSE (s."initialOnAccountMinor" - saf."fallbackCredits")
          END
        ) > 0
      LIMIT 1
    `;

    if (overdueSales && overdueSales.length > 0) {
      return {
        status: "rejected",
        code: "overdue_balance_exists",
        reason: `Customer ${sale.customerId} has past due invoice(s) under company ${sale.companyId}`,
      };
    }
  }

  // 4. Verify the credit-mode limit (LIMITED only; UNLIMITED has no monetary limit)
  const creditLimitMinor = mode.limitMinor;
  const newExposureMinor = currentReceivableMinor + amountMinor;

  if (!Number.isSafeInteger(newExposureMinor) || newExposureMinor < 0) {
    return {
      status: "rejected",
      code: "inconsistent_ledger_state",
      reason: `New credit exposure exceeds safe integer bounds`,
    };
  }

  if (creditLimitMinor !== null && newExposureMinor > creditLimitMinor) {
    return {
      status: "rejected",
      code: "credit_limit_exceeded",
      reason: `New credit exposure (${newExposureMinor} minor) exceeds credit limit (${creditLimitMinor} minor)`,
    };
  }

  const availableCreditMinor = availableUnder(creditLimitMinor, newExposureMinor);

  if (availableCreditMinor !== null && (!Number.isSafeInteger(availableCreditMinor) || availableCreditMinor < 0)) {
    return {
      status: "rejected",
      code: "inconsistent_ledger_state",
      reason: `Available credit is not a safe non-negative integer`,
    };
  }

  // 5. Post receivable entry
  try {
    const newEntry = await tx.khataReceivableEntry.create({
      data: {
        tenantId,
        companyId: sale.companyId,
        customerId: sale.customerId,
        creditAccountId: account.id,
        currency: sale.currencySnapshot,
        entryType: "DEBIT_CREDIT_SALE",
        amountMinor,
        saleId,
        actorUserId,
        notes: notes ?? null,
        idempotencyKey,
      },
    });

    return {
      status: "success",
      receivableEntryId: newEntry.id,
      idempotentReplay: false,
      currentReceivableMinor: newExposureMinor,
      availableCreditMinor,
      originalPostedAmountMinor: amountMinor,
    };
  } catch (error: any) {
    if (error?.code === "P2002" && isKnownIdempotencyConflict(error?.meta?.target)) {
      return {
        status: "rejected",
        code: "idempotency_conflict",
        reason: `A unique constraint conflict occurred while posting receivable entry (key: ${idempotencyKey})`,
      };
    }
    throw error;
  }
}
