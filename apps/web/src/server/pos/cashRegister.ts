import { randomUUID } from "node:crypto";
import { Prisma, type PaymentMethod } from "@prisma/client";
import { db } from "@/server/db";
import { writeAuditLogTx } from "@/server/identity/audit";
import { enqueueOutboxEvent } from "@/server/events/outbox";
import { canApproveInStore, verifyApprovalPin } from "@/server/identity/approvalPin";

/**
 * Cash register and day close (screens 53-54), shaped like ERPNext's POS Opening Entry (an opening
 * float) and POS Closing Entry (a count per payment method against what was expected, and the
 * difference). AMBURAX keeps these itself for now: AMBURAX sales reach ERPNext as Sales Invoices,
 * not POS Invoices, so ERPNext's closing entry has nothing to reconcile against (latter.md E4).
 *
 * Expected, per method, for one shift:
 *   CASH  = opening float + confirmed cash taken on this shift's bills + paid in − paid out
 *           − cash refunded by this till (E7: a return records the till that paid it)
 *   UPI / CARD = confirmed payments of that method on this shift's bills
 *
 * Returns made before E7 carry no till; the store's cash refunds of that kind during the shift are
 * shown beside the figures instead, never silently netted against a drawer.
 */

export const METHODS: PaymentMethod[] = ["CASH", "UPI", "CARD"];
/** ₹10,00,000 — a sane ceiling for one drawer movement or float. */
export const MAX_CASH_MINOR = 100_000_000;

type Actor = { tenantId: string; userId: string; tenantRole: "OWNER" | "STAFF" };

/** The cashier on the shift, the owner, or a store manager of that store may handle its cash. */
export async function canHandleCash(actor: Actor, session: { cashierUserId: string; storeId: string }): Promise<boolean> {
  if (actor.tenantRole === "OWNER" || session.cashierUserId === actor.userId) return true;
  const m = await db.storeMembership.findFirst({
    where: { tenantId: actor.tenantId, userId: actor.userId, storeId: session.storeId },
    select: { role: true },
  });
  return m?.role === "STORE_MANAGER";
}

type Client = Prisma.TransactionClient | typeof db;

/** Confirmed cash this till has refunded on returns (E7). */
async function sessionCashRefunds(client: Client, tenantId: string, sessionId: string): Promise<number> {
  const rows = await client.$queryRaw<{ total: bigint }[]>`
    SELECT COALESCE(SUM(rp."amountMinor"), 0) AS "total"
      FROM "sale_return_payments" rp
      JOIN "sale_returns" r ON r."id" = rp."saleReturnId"
     WHERE r."tenantId" = ${tenantId} AND r."posSessionId" = ${sessionId} AND r."status" = 'COMPLETED'
       AND rp."method" = 'CASH' AND rp."status" = 'CONFIRMED'
  `;
  return Number(rows[0]?.total ?? 0);
}

/**
 * What the drawer should hold right now. Pass a transaction that has locked the session row (see
 * lockSession) when the answer gates a cash payout, so two payouts can't both see the same cash.
 */
export async function expectedDrawerCash(client: Client, tenantId: string, sessionId: string): Promise<number> {
  const [session, taken, moves, refunded] = await Promise.all([
    client.posSession.findFirst({ where: { id: sessionId, tenantId }, select: { openingFloatMinor: true } }),
    takings(tenantId, sessionId, client),
    client.cashMovement.groupBy({ by: ["kind"], where: { tenantId, sessionId }, _sum: { amountMinor: true } }),
    sessionCashRefunds(client, tenantId, sessionId),
  ]);
  const sum = (k: "PAY_IN" | "PAY_OUT") => moves.find((m) => m.kind === k)?._sum.amountMinor ?? 0;
  return (session?.openingFloatMinor ?? 0) + taken.CASH + sum("PAY_IN") - sum("PAY_OUT") - refunded;
}

/** Row-lock a shift for the rest of the transaction; serialises cash payouts from one drawer. */
export async function lockSession(tx: Prisma.TransactionClient, tenantId: string, sessionId: string) {
  await tx.$queryRaw`SELECT "id" FROM "pos_sessions" WHERE "id" = ${sessionId} AND "tenantId" = ${tenantId} FOR UPDATE`;
}

/**
 * Money taken during a shift, per method:
 * - sales linked to the shift;
 * - sales the same cashier rang up at the same store during the shift but that carry no shift
 *   (made from the quick POS screen before it attached one);
 * - khata dues the same cashier collected during the shift (paid into this drawer / UPI / card).
 */
async function takings(tenantId: string, sessionId: string, client: Client = db) {
  const rows = await client.$queryRaw<{ method: PaymentMethod; total: bigint }[]>`
    WITH ps AS (
      SELECT "id", "storeId", "cashierUserId", "openedAt", COALESCE("closedAt", now() AT TIME ZONE 'UTC') AS "until"
        FROM "pos_sessions" WHERE "id" = ${sessionId} AND "tenantId" = ${tenantId}
    ), money AS (
      SELECT p."method", p."amountMinor"
        FROM "sale_payments" p
        JOIN "sales" s ON s."id" = p."saleId"
        JOIN ps ON (s."posSessionId" = ps."id"
                    OR (s."posSessionId" IS NULL AND s."storeId" = ps."storeId" AND s."cashierUserId" = ps."cashierUserId"
                        AND s."createdAt" >= ps."openedAt" AND s."createdAt" <= ps."until"))
       WHERE s."tenantId" = ${tenantId} AND s."status" = 'COMPLETED' AND p."status" = 'CONFIRMED'
      UNION ALL
      SELECT k."paymentMethod", k."amountMinor"
        FROM "khata_payments" k
        JOIN ps ON k."actorUserId" = ps."cashierUserId" AND k."createdAt" >= ps."openedAt" AND k."createdAt" <= ps."until"
       WHERE k."tenantId" = ${tenantId}
    )
    SELECT "method", COALESCE(SUM("amountMinor"), 0) AS "total" FROM money GROUP BY "method"
  `;
  const out: Record<PaymentMethod, number> = { CASH: 0, UPI: 0, CARD: 0 };
  for (const r of rows) out[r.method] = Number(r.total);
  return out;
}

/**
 * Each salesman's share of a shift (shared counter): bills and amount per person who sold, by the
 * same rule `takings` uses to decide which sales belong to the shift.
 */
async function sellersOf(tenantId: string, sessionId: string) {
  const rows = await db.$queryRaw<{ userId: string; name: string; bills: bigint; total: bigint }[]>`
    WITH ps AS (
      SELECT "id", "storeId", "cashierUserId", "openedAt", COALESCE("closedAt", now() AT TIME ZONE 'UTC') AS "until"
        FROM "pos_sessions" WHERE "id" = ${sessionId} AND "tenantId" = ${tenantId}
    )
    SELECT u."id" AS "userId", u."name", COUNT(s."id") AS "bills", COALESCE(SUM(s."totalMinor"), 0) AS "total"
      FROM "sales" s
      JOIN ps ON (s."posSessionId" = ps."id"
                  OR (s."posSessionId" IS NULL AND s."storeId" = ps."storeId" AND s."cashierUserId" = ps."cashierUserId"
                      AND s."createdAt" >= ps."openedAt" AND s."createdAt" <= ps."until"))
      JOIN "users" u ON u."id" = s."cashierUserId"
     WHERE s."tenantId" = ${tenantId} AND s."status" = 'COMPLETED'
     GROUP BY u."id", u."name"
     ORDER BY 4 DESC
  `;
  return rows.map((r) => ({ userId: r.userId, name: r.name, bills: Number(r.bills), totalMinor: Number(r.total) }));
}

export async function getRegister(params: { tenantId: string; sessionId: string; now?: Date }) {
  const session = await db.posSession.findFirst({
    where: { id: params.sessionId, tenantId: params.tenantId },
    select: {
      id: true,
      storeId: true,
      cashierUserId: true,
      openedAt: true,
      closedAt: true,
      closingNote: true,
      openingFloatMinor: true,
      countedAt: true,
      countedByUserId: true,
      varianceStatus: true,
      varianceApprovedByUserId: true,
      varianceApprovedAt: true,
      varianceApprovalNote: true,
      variancePostingStatus: true,
      cashier: { select: { name: true } },
      posDevice: { select: { name: true, code: true } },
      store: { select: { name: true } },
      cashMovements: {
        orderBy: { createdAt: "asc" },
        select: { id: true, kind: true, amountMinor: true, reason: true, createdAt: true },
      },
      counts: { select: { method: true, expectedMinor: true, countedMinor: true, differenceMinor: true } },
      _count: { select: { sales: { where: { status: "COMPLETED" } } } },
    },
  });
  if (!session) return null;

  const until = session.closedAt ?? params.now ?? new Date();
  const [taken, refundedHere, refunds, sellers] = await Promise.all([
    takings(params.tenantId, session.id),
    sessionCashRefunds(db, params.tenantId, session.id),
    db.$queryRaw<{ total: bigint }[]>`
      SELECT COALESCE(SUM(rp."amountMinor"), 0) AS "total"
        FROM "sale_return_payments" rp
        JOIN "sale_returns" r ON r."id" = rp."saleReturnId"
       WHERE r."tenantId" = ${params.tenantId} AND r."storeId" = ${session.storeId} AND r."status" = 'COMPLETED'
         AND r."posSessionId" IS NULL
         AND rp."method" = 'CASH' AND r."createdAt" >= ${session.openedAt} AND r."createdAt" <= ${until}
    `,
    sellersOf(params.tenantId, session.id),
  ]);
  const paidIn = session.cashMovements.filter((m) => m.kind === "PAY_IN").reduce((s, m) => s + m.amountMinor, 0);
  const paidOut = session.cashMovements.filter((m) => m.kind === "PAY_OUT").reduce((s, m) => s + m.amountMinor, 0);
  const expected: Record<PaymentMethod, number> = {
    CASH: (session.openingFloatMinor ?? 0) + taken.CASH + paidIn - paidOut - refundedHere,
    UPI: taken.UPI,
    CARD: taken.CARD,
  };
  return {
    ...session,
    bills: session._count.sales,
    taken,
    paidIn,
    paidOut,
    refundedHere,
    expected,
    storeCashRefundsMinor: Number(refunds[0]?.total ?? 0),
    sellers,
  };
}

export type RegisterResult =
  | { status: "ok" }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "conflict"; reason: string }
  | { status: "validation_error"; reason: string };

async function openSessionFor(actor: Actor, sessionId: string): Promise<RegisterResult | null> {
  const session = await db.posSession.findFirst({
    where: { id: sessionId, tenantId: actor.tenantId },
    select: { id: true, storeId: true, cashierUserId: true, closedAt: true },
  });
  if (!session) return { status: "not_found" };
  if (!(await canHandleCash(actor, session))) return { status: "forbidden" };
  if (session.closedAt) return { status: "conflict", reason: "This shift is closed." };
  return null;
}

const validMoney = (n: number, min: number) => Number.isSafeInteger(n) && n >= min && n <= MAX_CASH_MINOR;

/** Record the cash in the drawer at the start of the shift. Once only; a mistake is corrected by a pay-in/out. */
export async function setOpeningFloat(input: {
  actor: Actor;
  sessionId: string;
  amountMinor: number;
  correlationId?: string;
}): Promise<RegisterResult> {
  if (!validMoney(input.amountMinor, 0)) return { status: "validation_error", reason: "Enter the float in rupees." };
  const refused = await openSessionFor(input.actor, input.sessionId);
  if (refused) return refused;
  const correlationId = input.correlationId ?? randomUUID();
  return db.$transaction(async (tx): Promise<RegisterResult> => {
    const set = await tx.posSession.updateMany({
      where: { id: input.sessionId, tenantId: input.actor.tenantId, closedAt: null, openingFloatMinor: null },
      data: { openingFloatMinor: input.amountMinor },
    });
    if (set.count !== 1) return { status: "conflict", reason: "The opening float is already recorded." };
    await writeAuditLogTx(tx, {
      tenantId: input.actor.tenantId,
      userId: input.actor.userId,
      action: "TillFloatSet",
      correlationId,
      metadata: { sessionId: input.sessionId, amountMinor: input.amountMinor },
    });
    return { status: "ok" };
  });
}

/**
 * Pay-out approval (E6, owner 2026-10-14). Initial INR defaults, not legal limits:
 *   up to Rs 2,000        the cashier records it (category, payee, reason)
 *   above Rs 2,000        a store manager or the owner approves with their own PIN
 *   Rs 10,000 or more     the owner approves
 * Judged on everything paid to the same payee during the shift, including this one, so one
 * payment can't be split into small ones to slip under a limit.
 */
export const PAYOUT_MANAGER_ABOVE_MINOR = 200_000;
export const PAYOUT_OWNER_FROM_MINOR = 1_000_000;
export const PAYOUT_CATEGORIES = ["PETTY_EXPENSE", "SUPPLIER_PAYMENT", "STAFF_ADVANCE", "BANK_DEPOSIT", "OTHER"] as const;
export type PayoutCategory = (typeof PAYOUT_CATEGORIES)[number];
export type ApprovalLevel = "NONE" | "MANAGER" | "OWNER";

export function payoutApprovalLevel(payeeTotalMinor: number): ApprovalLevel {
  if (payeeTotalMinor >= PAYOUT_OWNER_FROM_MINOR) return "OWNER";
  if (payeeTotalMinor > PAYOUT_MANAGER_ABOVE_MINOR) return "MANAGER";
  return "NONE";
}

const normalisePayee = (p: string) => p.trim().replace(/\s+/g, " ").toLowerCase();

export type MovementResult =
  | RegisterResult
  | { status: "approval_required"; level: "MANAGER" | "OWNER"; payeeTotalMinor: number }
  | { status: "approval_refused"; reason: string };

/** Cash paid into or out of the drawer mid-shift (change from the bank, a petty-cash purchase). */
export async function recordCashMovement(input: {
  actor: Actor;
  sessionId: string;
  kind: "PAY_IN" | "PAY_OUT";
  amountMinor: number;
  reason: string;
  idempotencyKey: string;
  /** Pay-outs only. */
  category?: string | null;
  payee?: string | null;
  /** Pay-outs over the limit: the approver's own id and PIN. */
  approval?: { approverUserId: string; pin: string } | null;
  correlationId?: string;
}): Promise<MovementResult> {
  if (!validMoney(input.amountMinor, 1)) return { status: "validation_error", reason: "Enter an amount above zero." };
  const reason = input.reason.trim().replace(/\s+/g, " ");
  if (reason.length < 3) return { status: "validation_error", reason: "Say what the cash was for." };
  if (reason.length > 140) return { status: "validation_error", reason: "Keep the reason under 140 characters." };
  if (input.idempotencyKey.length < 8) return { status: "validation_error", reason: "Reload the page and try again." };

  let category: PayoutCategory | null = null;
  let payee: string | null = null;
  if (input.kind === "PAY_OUT") {
    if (!input.category || !(PAYOUT_CATEGORIES as readonly string[]).includes(input.category)) {
      return { status: "validation_error", reason: "Choose what the pay-out is for." };
    }
    category = input.category as PayoutCategory;
    payee = (input.payee ?? "").trim().replace(/\s+/g, " ");
    if (payee.length < 2) return { status: "validation_error", reason: "Say who the cash was paid to." };
    if (payee.length > 140) return { status: "validation_error", reason: "Keep the payee under 140 characters." };
  }

  const existing = await db.cashMovement.findUnique({
    where: { tenantId_idempotencyKey: { tenantId: input.actor.tenantId, idempotencyKey: input.idempotencyKey } },
    select: { id: true },
  });
  if (existing) return { status: "ok" };
  const refused = await openSessionFor(input.actor, input.sessionId);
  if (refused) return refused;

  // Approval level from the payee's running total this shift (anti-splitting).
  let level: ApprovalLevel = "NONE";
  let approverUserId: string | null = null;
  if (input.kind === "PAY_OUT" && payee) {
    const earlier = await db.cashMovement.findMany({
      where: { tenantId: input.actor.tenantId, sessionId: input.sessionId, kind: "PAY_OUT", payee: { not: null } },
      select: { payee: true, amountMinor: true },
    });
    const payeeTotalMinor =
      earlier.filter((m) => normalisePayee(m.payee!) === normalisePayee(payee!)).reduce((a, m) => a + m.amountMinor, 0) +
      input.amountMinor;
    level = payoutApprovalLevel(payeeTotalMinor);
    if (level !== "NONE") {
      if (!input.approval) return { status: "approval_required", level, payeeTotalMinor };
      const session = await db.posSession.findFirstOrThrow({ where: { id: input.sessionId }, select: { storeId: true } });
      const approver = await db.user.findFirst({
        where: { id: input.approval.approverUserId, tenantId: input.actor.tenantId, status: "ACTIVE" },
        select: { id: true, tenantRole: true },
      });
      if (!approver) return { status: "approval_refused", reason: "Choose who is approving." };
      if (level === "OWNER" && approver.tenantRole !== "OWNER") {
        return { status: "approval_refused", reason: "Pay-outs of Rs 10,000 or more need the owner's approval." };
      }
      // A manager can't approve their own pay-out; the owner re-confirms with their own PIN.
      if (approver.id === input.actor.userId && approver.tenantRole !== "OWNER") {
        return { status: "approval_refused", reason: "Someone else has to approve your pay-out." };
      }
      const pin = await verifyApprovalPin({
        tenantId: input.actor.tenantId,
        storeId: session.storeId,
        approverUserId: approver.id,
        pin: input.approval.pin,
      });
      if (pin.status === "locked") return { status: "approval_refused", reason: "That approver's PIN is locked for now. Try later." };
      if (pin.status !== "ok") return { status: "approval_refused", reason: "That approval wasn't accepted. Check the approver and PIN." };
      approverUserId = approver.id;
    }
  }

  const correlationId = input.correlationId ?? randomUUID();
  try {
    return await db.$transaction(async (tx): Promise<MovementResult> => {
      // One drawer, one queue: refunds and pay-outs can't both spend the same cash.
      await lockSession(tx, input.actor.tenantId, input.sessionId);
      if (input.kind === "PAY_OUT") {
        const inDrawer = await expectedDrawerCash(tx, input.actor.tenantId, input.sessionId);
        if (input.amountMinor > inDrawer) {
          return { status: "validation_error", reason: "That is more cash than the drawer should hold." };
        }
      }
      await tx.cashMovement.create({
        data: {
          tenantId: input.actor.tenantId,
          sessionId: input.sessionId,
          kind: input.kind,
          amountMinor: input.amountMinor,
          reason,
          category,
          payee,
          approvedByUserId: approverUserId,
          approvalLevel: input.kind === "PAY_OUT" ? level : null,
          createdByUserId: input.actor.userId,
          idempotencyKey: input.idempotencyKey,
        },
      });
      await writeAuditLogTx(tx, {
        tenantId: input.actor.tenantId,
        userId: input.actor.userId,
        action: input.kind === "PAY_IN" ? "TillCashPaidIn" : "TillCashPaidOut",
        correlationId,
        metadata: {
          sessionId: input.sessionId,
          amountMinor: input.amountMinor,
          ...(input.kind === "PAY_OUT" ? { category, approvalLevel: level, approvedByUserId: approverUserId } : {}),
        },
      });
      return { status: "ok" };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { status: "ok" };
    throw err;
  }
}

/**
 * Close the shift with a count (screen 54): what is actually in the drawer and on the UPI / card
 * statements, per method. Any difference needs a note. Closes the shift and frees the till in the
 * same transaction, exactly as an ordinary close does.
 */
export async function closeAndCount(input: {
  actor: Actor;
  sessionId: string;
  counted: Record<PaymentMethod, number>;
  note?: string | null;
  correlationId?: string;
}): Promise<RegisterResult> {
  for (const m of METHODS) {
    if (!validMoney(input.counted[m], 0)) return { status: "validation_error", reason: `Enter the ${m.toLowerCase()} you counted.` };
  }
  const refused = await openSessionFor(input.actor, input.sessionId);
  if (refused) return refused;
  const reg = await getRegister({ tenantId: input.actor.tenantId, sessionId: input.sessionId });
  if (!reg) return { status: "not_found" };
  if (reg.openingFloatMinor === null) {
    return { status: "validation_error", reason: "Record the opening float before closing with a count." };
  }
  const rows = METHODS.map((m) => ({
    method: m,
    expectedMinor: reg.expected[m],
    countedMinor: input.counted[m],
    differenceMinor: input.counted[m] - reg.expected[m],
  }));
  const note = input.note?.trim().replace(/\s+/g, " ") || null;
  if (rows.some((r) => r.differenceMinor !== 0) && !note) {
    return { status: "validation_error", reason: "The count doesn't match. Add a note saying why." };
  }
  if (note && note.length > 500) return { status: "validation_error", reason: "That note is too long." };
  const correlationId = input.correlationId ?? randomUUID();

  return db.$transaction(async (tx): Promise<RegisterResult> => {
    const now = new Date();
    const closed = await tx.posSession.updateMany({
      where: { id: input.sessionId, tenantId: input.actor.tenantId, closedAt: null },
      data: {
        closedAt: now,
        closingNote: note,
        countedAt: now,
        countedByUserId: input.actor.userId,
        // E4: any difference waits for a manager; a clean count needs nothing more.
        varianceStatus: rows.some((r) => r.differenceMinor !== 0) ? "PENDING_APPROVAL" : "NONE",
      },
    });
    if (closed.count !== 1) return { status: "conflict", reason: "This shift is already closed." };
    await tx.sessionCount.createMany({
      data: rows.map((r) => ({ tenantId: input.actor.tenantId, sessionId: input.sessionId, ...r })),
    });
    const session = await tx.posSession.findUniqueOrThrow({ where: { id: input.sessionId }, select: { posDeviceId: true } });
    await tx.posDevice.updateMany({
      where: { id: session.posDeviceId, tenantId: input.actor.tenantId, activeSessionId: input.sessionId },
      data: { activeSessionId: null },
    });
    await writeAuditLogTx(tx, {
      tenantId: input.actor.tenantId,
      userId: input.actor.userId,
      action: "PosSessionClosedWithCount",
      correlationId,
      metadata: { sessionId: input.sessionId, differences: rows.map((r) => [r.method, r.differenceMinor]) },
    });
    return { status: "ok" };
  });
}

/**
 * Approve a counted difference (E4, owner 2026-10-14). Every nonzero difference needs it, whatever
 * the amount. The approver is the owner or a manager of that store, signed in as themselves, and is
 * never the person who counted or ran the till. After approval the difference waits for its ERPNext
 * cash over/short posting, which stays off until finance maps the account and the Journal Entry
 * write is approved (latter.md E4) — the status says so rather than pretending it was posted.
 */
export async function approveVariance(input: {
  actor: Actor;
  sessionId: string;
  note: string;
  correlationId?: string;
}): Promise<RegisterResult> {
  const note = input.note.trim().replace(/\s+/g, " ");
  if (note.length < 3) return { status: "validation_error", reason: "Say why the difference is accepted." };
  if (note.length > 500) return { status: "validation_error", reason: "That note is too long." };
  const session = await db.posSession.findFirst({
    where: { id: input.sessionId, tenantId: input.actor.tenantId },
    select: { id: true, storeId: true, cashierUserId: true, countedByUserId: true, varianceStatus: true },
  });
  if (!session) return { status: "not_found" };
  if (!(await canApproveInStore({ tenantId: input.actor.tenantId, storeId: session.storeId, userId: input.actor.userId }))) {
    return { status: "forbidden" };
  }
  if (input.actor.userId === session.countedByUserId || input.actor.userId === session.cashierUserId) {
    return { status: "conflict", reason: "Someone other than the cashier and the person who counted has to approve." };
  }
  if (session.varianceStatus !== "PENDING_APPROVAL") {
    return { status: "conflict", reason: "There is no difference waiting for approval on this shift." };
  }
  const correlationId = input.correlationId ?? randomUUID();
  return db.$transaction(async (tx): Promise<RegisterResult> => {
    const done = await tx.posSession.updateMany({
      where: { id: session.id, tenantId: input.actor.tenantId, varianceStatus: "PENDING_APPROVAL" },
      data: {
        varianceStatus: "APPROVED",
        varianceApprovedByUserId: input.actor.userId,
        varianceApprovedAt: new Date(),
        varianceApprovalNote: note,
        variancePostingStatus: "AWAITING_ACCOUNT_MAPPING",
      },
    });
    if (done.count !== 1) return { status: "conflict", reason: "This difference was just approved by someone else." };
    await writeAuditLogTx(tx, {
      tenantId: input.actor.tenantId,
      userId: input.actor.userId,
      action: "TillVarianceApproved",
      correlationId,
      metadata: { sessionId: session.id },
    });
    await enqueueOutboxEvent(tx, {
      tenantId: input.actor.tenantId,
      storeId: session.storeId,
      eventType: "TillVarianceApproved",
      entityId: session.id,
      correlationId,
      actorUserId: input.actor.userId,
      payload: { sessionId: session.id },
    });
    return { status: "ok" };
  });
}

/** IST day bounds for a YYYY-MM-DD date. */
export function istDay(date: string): { from: Date; to: Date } {
  const from = new Date(`${date}T00:00:00+05:30`);
  return { from, to: new Date(from.getTime() + 86_400_000) };
}

export function todayIst(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** Every shift opened in the store on one day, with its figures (screen 54). */
export async function listDayClose(params: { tenantId: string; storeId: string; date: string }) {
  const { from, to } = istDay(params.date);
  const sessions = await db.posSession.findMany({
    where: { tenantId: params.tenantId, storeId: params.storeId, openedAt: { gte: from, lt: to } },
    orderBy: { openedAt: "asc" },
    select: { id: true },
  });
  const registers = (await Promise.all(sessions.map((s) => getRegister({ tenantId: params.tenantId, sessionId: s.id })))).filter(
    (r): r is NonNullable<typeof r> => r !== null,
  );
  const sum = (f: (r: (typeof registers)[number]) => number) => registers.reduce((a, r) => a + f(r), 0);
  return {
    registers,
    totals: {
      bills: sum((r) => r.bills),
      cash: sum((r) => r.taken.CASH),
      upi: sum((r) => r.taken.UPI),
      card: sum((r) => r.taken.CARD),
      difference: sum((r) => r.counts.reduce((a, c) => a + c.differenceMinor, 0)),
      open: registers.filter((r) => !r.closedAt).length,
      awaitingApproval: registers.filter((r) => r.varianceStatus === "PENDING_APPROVAL").length,
      uncounted: registers.filter((r) => r.closedAt && !r.countedAt).length,
    },
  };
}

export async function listOpenSessions(params: { tenantId: string; storeId: string }) {
  return db.posSession.findMany({
    where: { tenantId: params.tenantId, storeId: params.storeId, closedAt: null },
    orderBy: { openedAt: "asc" },
    select: {
      id: true,
      openedAt: true,
      openingFloatMinor: true,
      cashierUserId: true,
      cashier: { select: { name: true } },
      posDevice: { select: { name: true, code: true } },
    },
  });
}

/**
 * What to suggest as the opening cash for a new shift on a terminal: the cash counted when that
 * terminal's last shift closed. A suggestion only — the cashier confirms or corrects it, and
 * setOpeningFloat records what they enter. Tenant-scoped; nothing when no shift was ever counted.
 */
export async function suggestedOpeningFloat(params: { tenantId: string; posDeviceId: string }) {
  const last = await db.posSession.findFirst({
    where: { tenantId: params.tenantId, posDeviceId: params.posDeviceId, closedAt: { not: null }, countedAt: { not: null } },
    orderBy: { closedAt: "desc" },
    select: { id: true, closedAt: true },
  });
  if (!last) return { suggestedMinor: null as number | null, fromClosedAt: null as Date | null };
  const cash = await db.sessionCount.findFirst({
    where: { tenantId: params.tenantId, sessionId: last.id, method: "CASH" },
    select: { countedMinor: true },
  });
  return { suggestedMinor: cash?.countedMinor ?? null, fromClosedAt: last.closedAt };
}

/** The opening cash already recorded on a shift, if any (null = not recorded yet). */
export async function openingFloatOf(params: { tenantId: string; sessionId: string }) {
  const s = await db.posSession.findFirst({
    where: { id: params.sessionId, tenantId: params.tenantId },
    select: { openingFloatMinor: true },
  });
  return s?.openingFloatMinor ?? null;
}

