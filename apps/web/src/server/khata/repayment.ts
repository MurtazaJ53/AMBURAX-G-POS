import { randomUUID } from "node:crypto";
import { Prisma, type PaymentMethod } from "@prisma/client";
import { db } from "@/server/db";
import { writeAuditLogTx } from "@/server/identity/audit";
import { enqueueOutboxEvent } from "@/server/events/outbox";
import { STORE_SCOPE_SELECT, storeScopeOf } from "@/server/sales/storeScope";
import { compareSalesForFifoRepayment } from "./dueDate";
import { onCreditBillSettled } from "@/server/loyalty/loyalty";

/**
 * Collecting dues (Q6/Q7, owner 2026-10-14).
 *
 * - FIFO: a repayment settles the oldest outstanding bills first — due date, then bill date, then id —
 *   within one legal Company and currency (the store's), never across Companies.
 * - No overpayment, no advances in this release: cash pays at most what is owed and the rest is
 *   handed back as change (only the applied amount is recorded); UPI or card above what is owed is
 *   refused outright.
 * - One transaction, under the credit account's row lock: the payment, one allocation per bill, one
 *   CREDIT_REPAYMENT ledger entry per allocation, the ERP outbox event and the audit row. Retries with
 *   the same key return the first result.
 */

type Actor = { tenantId: string; userId: string };

export interface OpenBill {
  saleId: string;
  billNumber: string;
  completedAt: Date;
  dueDate: Date | null;
  outstandingMinor: number;
}

async function openBills(
  client: Prisma.TransactionClient | typeof db,
  scope: { tenantId: string; companyId: string; customerId: string; currency: string },
): Promise<OpenBill[]> {
  const rows = await client.$queryRaw<
    { saleId: string; billNumber: string; completedAt: Date; dueDate: Date | null; outstanding: bigint }[]
  >`
    SELECT s."id" AS "saleId", s."billNumber", s."completedAt", s."dueDateSnapshot" AS "dueDate",
           SUM(CASE WHEN e."entryType" IN ('DEBIT_CREDIT_SALE', 'DEBIT_REVERSAL') THEN e."amountMinor" ELSE -e."amountMinor" END) AS "outstanding"
      FROM "khata_receivable_entries" e
      JOIN "sales" s ON s."id" = e."saleId" AND s."tenantId" = e."tenantId"
     WHERE e."tenantId" = ${scope.tenantId} AND e."companyId" = ${scope.companyId}
       AND e."customerId" = ${scope.customerId} AND e."currency" = ${scope.currency}
       AND e."saleId" IS NOT NULL
     GROUP BY s."id", s."billNumber", s."completedAt", s."dueDateSnapshot"
    HAVING SUM(CASE WHEN e."entryType" IN ('DEBIT_CREDIT_SALE', 'DEBIT_REVERSAL') THEN e."amountMinor" ELSE -e."amountMinor" END) > 0
  `;
  return rows
    .map((r) => ({
      saleId: r.saleId,
      billNumber: r.billNumber,
      completedAt: r.completedAt,
      dueDate: r.dueDate,
      outstandingMinor: Number(r.outstanding),
    }))
    .sort((a, b) =>
      compareSalesForFifoRepayment(
        { id: a.saleId, dueDateSnapshot: a.dueDate, completedAt: a.completedAt },
        { id: b.saleId, dueDateSnapshot: b.dueDate, completedAt: b.completedAt },
      ),
    );
}

async function scopeFor(tenantId: string, storeId: string) {
  const store = await db.store.findFirst({ where: { id: storeId, tenantId }, select: STORE_SCOPE_SELECT });
  return store ? storeScopeOf(store) : null;
}

/** What the customer owes in this store's Company, bill by bill, oldest first. */
export async function getOpenBills(params: { tenantId: string; storeId: string; customerId: string }) {
  const scope = await scopeFor(params.tenantId, params.storeId);
  if (!scope) return null;
  const bills = await openBills(db, {
    tenantId: params.tenantId,
    companyId: scope.companyId,
    customerId: params.customerId,
    currency: scope.currency,
  });
  return { currency: scope.currency, bills, totalMinor: bills.reduce((s, b) => s + b.outstandingMinor, 0) };
}

export type RepaymentResult =
  | {
      status: "ok";
      paymentId: string;
      appliedMinor: number;
      /** Cash to hand back: tendered minus applied. Zero for UPI and card. */
      changeMinor: number;
      allocations: { saleId: string; billNumber: string; amountMinor: number }[];
      remainingMinor: number;
      duplicate: boolean;
    }
  | { status: "not_found" }
  | { status: "company_unavailable" }
  | { status: "nothing_due" }
  | { status: "validation_error"; reason: string };

export async function collectRepayment(input: {
  actor: Actor;
  storeId: string;
  customerId: string;
  method: PaymentMethod;
  /** For cash: what the customer handed over. For UPI/card: the amount paid. */
  tenderedMinor: number;
  reference?: string | null;
  idempotencyKey: string;
  correlationId?: string;
}): Promise<RepaymentResult> {
  if (!Number.isSafeInteger(input.tenderedMinor) || input.tenderedMinor <= 0) {
    return { status: "validation_error", reason: "Enter the amount received." };
  }
  if (input.idempotencyKey.length < 8) return { status: "validation_error", reason: "Reload the page and try again." };
  const reference = input.reference?.trim().slice(0, 140) || null;
  if (input.method !== "CASH" && !reference) {
    return { status: "validation_error", reason: "Enter the UPI or card reference." };
  }

  const prior = await db.khataPayment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (prior) {
    if (prior.tenantId !== input.actor.tenantId) return { status: "validation_error", reason: "Reload the page and try again." };
    const allocs = await db.khataPaymentAllocation.findMany({
      where: { tenantId: prior.tenantId, khataPaymentId: prior.id },
      select: { saleId: true, amountMinor: true, sale: { select: { billNumber: true } } },
    });
    const open = await getOpenBills({ tenantId: prior.tenantId, storeId: input.storeId, customerId: prior.customerId });
    return {
      status: "ok",
      paymentId: prior.id,
      appliedMinor: prior.amountMinor,
      changeMinor: prior.paymentMethod === "CASH" ? Math.max(0, input.tenderedMinor - prior.amountMinor) : 0,
      allocations: allocs.map((a) => ({ saleId: a.saleId, billNumber: a.sale.billNumber, amountMinor: a.amountMinor })),
      remainingMinor: open?.totalMinor ?? 0,
      duplicate: true,
    };
  }

  const customer = await db.customer.findFirst({
    where: { id: input.customerId, tenantId: input.actor.tenantId },
    select: { id: true },
  });
  if (!customer) return { status: "not_found" };
  const scope = await scopeFor(input.actor.tenantId, input.storeId);
  if (!scope) return { status: "company_unavailable" };
  const correlationId = input.correlationId ?? randomUUID();

  try {
    return await db.$transaction(async (tx): Promise<RepaymentResult> => {
      const account = await tx.customerCreditAccount.findUnique({
        where: {
          tenantId_companyId_customerId: { tenantId: input.actor.tenantId, companyId: scope.companyId, customerId: customer.id },
        },
        select: { id: true, currency: true },
      });
      if (!account || account.currency !== scope.currency) return { status: "nothing_due" };
      // One repayment at a time per account: the lock serialises allocation across tills.
      await tx.$queryRaw`SELECT "id" FROM "customer_credit_accounts" WHERE "id" = ${account.id} FOR UPDATE`;

      const key = { tenantId: input.actor.tenantId, companyId: scope.companyId, customerId: customer.id, currency: scope.currency };
      const bills = await openBills(tx, key);
      const owed = bills.reduce((s, b) => s + b.outstandingMinor, 0);
      if (owed <= 0) return { status: "nothing_due" };

      let applied = input.tenderedMinor;
      let change = 0;
      if (input.tenderedMinor > owed) {
        if (input.method !== "CASH") {
          return {
            status: "validation_error",
            reason: "That is more than is owed. Take exactly what is due by UPI or card; overpayments can't be kept as credit.",
          };
        }
        applied = owed;
        change = input.tenderedMinor - owed;
      }

      const payment = await tx.khataPayment.create({
        data: {
          tenantId: input.actor.tenantId,
          customerId: customer.id,
          actorUserId: input.actor.userId,
          amountMinor: applied,
          paymentMethod: input.method,
          reference,
          idempotencyKey: input.idempotencyKey,
          companyId: scope.companyId,
          creditAccountId: account.id,
          currency: scope.currency,
        },
      });

      const allocations: { saleId: string; billNumber: string; amountMinor: number }[] = [];
      let left = applied;
      for (const bill of bills) {
        if (left <= 0) break;
        const amount = Math.min(left, bill.outstandingMinor);
        const allocation = await tx.khataPaymentAllocation.create({
          data: {
            tenantId: input.actor.tenantId,
            companyId: scope.companyId,
            customerId: customer.id,
            creditAccountId: account.id,
            currency: scope.currency,
            khataPaymentId: payment.id,
            saleId: bill.saleId,
            amountMinor: amount,
          },
          select: { id: true },
        });
        await tx.khataReceivableEntry.create({
          data: {
            tenantId: input.actor.tenantId,
            companyId: scope.companyId,
            customerId: customer.id,
            creditAccountId: account.id,
            currency: scope.currency,
            entryType: "CREDIT_REPAYMENT",
            amountMinor: amount,
            saleId: bill.saleId,
            paymentAllocationId: allocation.id,
            actorUserId: input.actor.userId,
            idempotencyKey: `repayment:${payment.id}:${bill.saleId}`,
          },
        });
        allocations.push({ saleId: bill.saleId, billNumber: bill.billNumber, amountMinor: amount });
        left -= amount;
        // Decision 41: a bill paid in full releases its pending loyalty points (inert until sign-off).
        if (amount === bill.outstandingMinor) {
          await onCreditBillSettled(tx, { tenantId: input.actor.tenantId, saleId: bill.saleId, currency: scope.currency });
        }
      }

      await enqueueOutboxEvent(tx, {
        tenantId: input.actor.tenantId,
        storeId: input.storeId,
        eventType: "CustomerPaymentCollected",
        actorUserId: input.actor.userId,
        correlationId,
        entityId: payment.id,
        payload: { paymentId: payment.id, customerId: customer.id, amountMinor: applied, paymentMethod: input.method },
      });
      await writeAuditLogTx(tx, {
        tenantId: input.actor.tenantId,
        userId: input.actor.userId,
        action: "KhataRepaymentCollected",
        correlationId,
        metadata: { paymentId: payment.id, customerId: customer.id, appliedMinor: applied, bills: allocations.length },
      });
      return {
        status: "ok",
        paymentId: payment.id,
        appliedMinor: applied,
        changeMinor: change,
        allocations,
        remainingMinor: owed - applied,
        duplicate: false,
      };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const again = await db.khataPayment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (again) return collectRepayment(input);
    }
    throw err;
  }
}

/** Everyone who owes in this store's Company, largest balance first (the collect screen's list). */
export async function listDebtors(params: { tenantId: string; storeId: string; limit?: number }) {
  const scope = await scopeFor(params.tenantId, params.storeId);
  if (!scope) return null;
  const rows = await db.$queryRaw<{ customerId: string; name: string; phone: string | null; owed: bigint; bills: bigint }[]>`
    SELECT c."id" AS "customerId", c."name", c."phone", x."owed", x."bills"
      FROM (
        SELECT e."customerId",
               SUM(CASE WHEN e."entryType" IN ('DEBIT_CREDIT_SALE', 'DEBIT_REVERSAL') THEN e."amountMinor" ELSE -e."amountMinor" END) AS "owed",
               COUNT(DISTINCT e."saleId") AS "bills"
          FROM "khata_receivable_entries" e
         WHERE e."tenantId" = ${params.tenantId} AND e."companyId" = ${scope.companyId} AND e."currency" = ${scope.currency}
         GROUP BY e."customerId"
      ) x
      JOIN "customers" c ON c."id" = x."customerId" AND c."tenantId" = ${params.tenantId}
     WHERE x."owed" > 0
     ORDER BY x."owed" DESC
     LIMIT ${Math.min(params.limit ?? 200, 500)}
  `;
  return rows.map((r) => ({ customerId: r.customerId, name: r.name, phone: r.phone, owedMinor: Number(r.owed), bills: Number(r.bills) }));
}
