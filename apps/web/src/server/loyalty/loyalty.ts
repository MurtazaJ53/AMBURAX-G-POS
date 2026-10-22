import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAuditLog, writeAuditLogTx } from "@/server/identity/audit";

/**
 * Loyalty (decision 41, owner 2026-10-14).
 *
 * Designed now, switched on later: earning and redemption stay OFF until finance and the GST
 * reviewer approve the tax treatment. `LOYALTY_SIGNOFF` is the hard gate — a program's `enabled`
 * flag alone does nothing, and flipping the gate is a reviewed code change, not a setting anyone
 * can toggle. Checkout, returns and khata repayment call the hooks at the bottom; they do nothing
 * until the gate is flipped.
 *
 * Rules (all per program and currency, stored as data): points per Rs 100 of eligible net spend
 * excluding GST; a point's value; expiry; minimum to redeem; most of a bill points may pay;
 * oldest-expiring points used first; returns reverse with compensating entries; points on a credit
 * sale stay PENDING until it is settled. The ledger is append-only — there is no balance column to
 * edit, only entries.
 */
export const LOYALTY_SIGNOFF = { finance: false, gst: false } as const;

type Actor = { tenantId: string; userId: string; tenantRole: "OWNER" | "STAFF" };
type Tx = Prisma.TransactionClient;
type Program = Awaited<ReturnType<typeof db.loyaltyProgram.findFirstOrThrow>>;

export const DEFAULT_PROGRAM = {
  pointsPerUnit: 1,
  earnUnitMinor: 10_000,
  pointValueMinor: 100,
  expiryMonths: 12,
  minRedeemPoints: 100,
  maxRedeemBp: 1_000,
} as const;

export function loyaltyLive(program: { enabled: boolean } | null): boolean {
  return Boolean(program?.enabled && LOYALTY_SIGNOFF.finance && LOYALTY_SIGNOFF.gst);
}

/** Points for a bill: whole units of eligible net spend (GST excluded by the caller), rounded down. */
export function pointsFor(eligibleNetMinor: number, p: Pick<Program, "pointsPerUnit" | "earnUnitMinor">): number {
  if (eligibleNetMinor <= 0) return 0;
  return Math.floor(eligibleNetMinor / p.earnUnitMinor) * p.pointsPerUnit;
}

/** The most points a bill can take under the per-bill cap, in whole points. */
export function maxRedeemablePoints(eligibleMinor: number, p: Pick<Program, "maxRedeemBp" | "pointValueMinor">): number {
  if (eligibleMinor <= 0) return 0;
  return Math.floor((eligibleMinor * p.maxRedeemBp) / 10_000 / p.pointValueMinor);
}

function addMonths(d: Date, months: number): Date {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + months);
  return r;
}

export async function getProgram(tenantId: string, currency = "INR") {
  return db.loyaltyProgram.findFirst({ where: { tenantId, currency } });
}

export type ProgramInput = {
  pointsPerUnit: number;
  earnUnitMinor: number;
  pointValueMinor: number;
  expiryMonths: number;
  minRedeemPoints: number;
  maxRedeemBp: number;
};

function pick(p: Program): ProgramInput {
  const { pointsPerUnit, earnUnitMinor, pointValueMinor, expiryMonths, minRedeemPoints, maxRedeemBp } = p;
  return { pointsPerUnit, earnUnitMinor, pointValueMinor, expiryMonths, minRedeemPoints, maxRedeemBp };
}

/** The owner sets the rules (stored, not live). Changes are audited with old and new values. */
export async function saveProgram(input: { actor: Actor; currency?: string; rules: ProgramInput }) {
  if (input.actor.tenantRole !== "OWNER") return { status: "forbidden" as const };
  const r = input.rules;
  const ints = Object.values(r).every((v) => Number.isInteger(v));
  if (
    !ints ||
    r.pointsPerUnit < 1 ||
    r.earnUnitMinor < 100 ||
    r.pointValueMinor < 1 ||
    r.expiryMonths < 1 ||
    r.expiryMonths > 60 ||
    r.minRedeemPoints < 0 ||
    r.maxRedeemBp < 0 ||
    r.maxRedeemBp > 10_000
  ) {
    return { status: "validation_error" as const, reason: "Check the numbers: whole values, a cap between 0% and 100%, expiry 1–60 months." };
  }
  const currency = input.currency ?? "INR";
  const before = await getProgram(input.actor.tenantId, currency);
  const saved = await db.loyaltyProgram.upsert({
    where: { tenantId_currency: { tenantId: input.actor.tenantId, currency } },
    create: { tenantId: input.actor.tenantId, currency, ...r, updatedByUserId: input.actor.userId },
    update: { ...r, updatedByUserId: input.actor.userId },
  });
  await writeAuditLog({
    tenantId: input.actor.tenantId,
    userId: input.actor.userId,
    action: "LoyaltyProgramSaved",
    correlationId: randomUUID(),
    metadata: { currency, before: before ? pick(before) : null, after: pick(saved) },
  });
  return { status: "ok" as const, program: saved };
}

/** Points a customer can spend now (posted, unexpired lots) and points waiting on a credit sale. */
export async function balance(params: { tenantId: string; customerId: string; programId: string; now?: Date }) {
  const now = params.now ?? new Date();
  const scope = { tenantId: params.tenantId, customerId: params.customerId, programId: params.programId };
  const [available, pending] = await Promise.all([
    db.loyaltyLedgerEntry.aggregate({
      where: { ...scope, status: "POSTED", remaining: { gt: 0 }, expiresAt: { gt: now } },
      _sum: { remaining: true },
    }),
    db.loyaltyLedgerEntry.aggregate({ where: { ...scope, status: "PENDING" }, _sum: { points: true } }),
  ]);
  return { available: available._sum.remaining ?? 0, pending: pending._sum.points ?? 0 };
}

/** Serialise a customer's lots for this transaction so two bills can't spend the same points. */
async function lockCustomer(tx: Tx, tenantId: string, customerId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`loyalty:${tenantId}:${customerId}`}))`;
}

type Scope = { tenantId: string; customerId: string; programId: string };

/** Take points from lots oldest-expiring first (a preferred lot first, if given). */
async function consume(tx: Tx, scope: Scope, points: number, now: Date, preferEntryId?: string) {
  const lots = await tx.loyaltyLedgerEntry.findMany({
    where: { ...scope, status: "POSTED", remaining: { gt: 0 }, expiresAt: { gt: now } },
    orderBy: [{ expiresAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  if (preferEntryId) lots.sort((a, b) => Number(b.id === preferEntryId) - Number(a.id === preferEntryId));
  const taken: { entryId: string; points: number }[] = [];
  let left = points;
  for (const lot of lots) {
    if (left === 0) break;
    const n = Math.min(lot.remaining, left);
    await tx.loyaltyLedgerEntry.update({ where: { id: lot.id }, data: { remaining: { decrement: n } } });
    taken.push({ entryId: lot.id, points: n });
    left -= n;
  }
  return { taken, short: left };
}

/**
 * Earn on a sale. GST is excluded by the caller (eligible net). On a credit sale the points are
 * PENDING until `settleCreditSale`. Idempotent per sale.
 */
export async function earnForSale(
  tx: Tx,
  input: { program: Program; customerId: string; saleId: string; eligibleNetMinor: number; onCredit: boolean; now?: Date },
) {
  const points = pointsFor(input.eligibleNetMinor, input.program);
  if (points === 0) return { status: "ok" as const, points: 0 };
  const now = input.now ?? new Date();
  const key = `earn:${input.saleId}`;
  const existing = await tx.loyaltyLedgerEntry.findFirst({ where: { tenantId: input.program.tenantId, idempotencyKey: key } });
  if (existing) return { status: "ok" as const, points: existing.points };
  await tx.loyaltyLedgerEntry.create({
    data: {
      tenantId: input.program.tenantId,
      programId: input.program.id,
      customerId: input.customerId,
      type: "EARN",
      status: input.onCredit ? "PENDING" : "POSTED",
      points,
      remaining: input.onCredit ? 0 : points,
      expiresAt: input.onCredit ? null : addMonths(now, input.program.expiryMonths),
      saleId: input.saleId,
      idempotencyKey: key,
    },
  });
  return { status: "ok" as const, points };
}

/**
 * A credit sale is fully paid: its pending points post now (less any pending return reversal), and
 * their expiry starts now.
 */
export async function settleCreditSale(input: { tenantId: string; saleId: string; now?: Date }) {
  return db.$transaction((tx) => settleCreditSaleTx(tx, input));
}

export async function settleCreditSaleTx(tx: Tx, input: { tenantId: string; saleId: string; now?: Date }) {
  const now = input.now ?? new Date();
  {
    const e = await tx.loyaltyLedgerEntry.findFirst({ where: { tenantId: input.tenantId, saleId: input.saleId, type: "EARN", status: "PENDING" } });
    if (!e) return { status: "ok" as const, posted: 0 };
    const program = await tx.loyaltyProgram.findUniqueOrThrow({ where: { id: e.programId } });
    const reversed = await tx.loyaltyLedgerEntry.aggregate({
      where: { tenantId: input.tenantId, sourceEntryId: e.id, type: "REVERSE_EARN", status: "PENDING" },
      _sum: { points: true },
    });
    const net = Math.max(0, e.points + (reversed._sum.points ?? 0));
    const claimed = await tx.loyaltyLedgerEntry.updateMany({
      where: { id: e.id, status: "PENDING" },
      data: { status: "POSTED", remaining: net, expiresAt: addMonths(now, program.expiryMonths) },
    });
    if (claimed.count !== 1) return { status: "ok" as const, posted: 0 };
    await tx.loyaltyLedgerEntry.updateMany({ where: { sourceEntryId: e.id, type: "REVERSE_EARN", status: "PENDING" }, data: { status: "POSTED" } });
    return { status: "ok" as const, posted: net };
  }
}

// --- Checkout hooks -----------------------------------------------------------------------------
//
// Called from the sale, return and khata-repayment transactions. Each one does nothing unless
// `loyaltyLive` — i.e. until LOYALTY_SIGNOFF is flipped after finance and GST approval — so wiring
// them in changes no behaviour today. Eligible value is always the bill net of GST
// (totalMinor − taxMinor), whatever the tax-inclusive setting.

async function liveProgram(tx: Tx, tenantId: string, currency: string | null) {
  if (!LOYALTY_SIGNOFF.finance || !LOYALTY_SIGNOFF.gst) return null;
  const program = await tx.loyaltyProgram.findFirst({ where: { tenantId, currency: currency ?? "INR" } });
  return loyaltyLive(program) ? program : null;
}

export async function onSaleCompleted(
  tx: Tx,
  sale: { tenantId: string; id: string; customerId: string | null; currency: string | null; totalMinor: number; taxMinor: number; onAccountMinor: number },
) {
  if (!sale.customerId) return;
  const program = await liveProgram(tx, sale.tenantId, sale.currency);
  if (!program) return;
  await earnForSale(tx, {
    program,
    customerId: sale.customerId,
    saleId: sale.id,
    eligibleNetMinor: sale.totalMinor - sale.taxMinor,
    onCredit: sale.onAccountMinor > 0,
  });
}

export async function onReturnCompleted(
  tx: Tx,
  input: { tenantId: string; saleId: string; returnId: string; currency: string | null; refundMinor: number; saleTotalMinor: number },
) {
  if (!(await liveProgram(tx, input.tenantId, input.currency))) return;
  await reverseForReturn(tx, {
    tenantId: input.tenantId,
    saleId: input.saleId,
    returnId: input.returnId,
    returnedMinor: input.refundMinor,
    saleEligibleMinor: input.saleTotalMinor,
  });
}

export async function onCreditBillSettled(tx: Tx, input: { tenantId: string; saleId: string; currency: string | null }) {
  if (!(await liveProgram(tx, input.tenantId, input.currency))) return;
  await settleCreditSaleTx(tx, { tenantId: input.tenantId, saleId: input.saleId });
}

/** Thrown inside the caller's transaction so the whole bill rolls back. */
export class LoyaltyShortError extends Error {
  constructor() {
    super("Not enough points.");
  }
}

export type RedeemResult = { status: "ok"; points: number; valueMinor: number } | { status: "validation_error"; reason: string };

/** Spend points on a bill, within the minimum and the per-bill cap. Idempotent per sale. */
export async function redeemOnSale(
  tx: Tx,
  input: { program: Program; customerId: string; saleId: string; points: number; eligibleMinor: number; now?: Date },
): Promise<RedeemResult> {
  const p = input.program;
  const now = input.now ?? new Date();
  if (!Number.isInteger(input.points) || input.points <= 0) return { status: "validation_error", reason: "Enter whole points." };
  if (input.points < p.minRedeemPoints) return { status: "validation_error", reason: `At least ${p.minRedeemPoints} points can be redeemed at once.` };
  const cap = maxRedeemablePoints(input.eligibleMinor, p);
  if (input.points > cap) return { status: "validation_error", reason: `This bill can take at most ${cap} points.` };
  const key = `redeem:${input.saleId}`;
  const existing = await tx.loyaltyLedgerEntry.findFirst({ where: { tenantId: p.tenantId, idempotencyKey: key } });
  if (existing) return { status: "ok", points: -existing.points, valueMinor: -existing.points * p.pointValueMinor };
  const scope = { tenantId: p.tenantId, customerId: input.customerId, programId: p.id };
  await lockCustomer(tx, p.tenantId, input.customerId);
  const { taken, short } = await consume(tx, scope, input.points, now);
  if (short > 0) throw new LoyaltyShortError();
  await tx.loyaltyLedgerEntry.create({
    data: { ...scope, type: "REDEEM", points: -input.points, saleId: input.saleId, allocations: taken, idempotencyKey: key },
  });
  return { status: "ok", points: input.points, valueMinor: input.points * p.pointValueMinor };
}

/**
 * A return: compensating entries, never edits. Earned points come back in proportion to the value
 * returned (taken from that sale's lot first, then oldest-expiring); redeemed points are given back in
 * the same proportion as a new lot with the earliest expiry of the lots they came from. Points already
 * spent that can't be recovered are recorded as `unrecovered`, never forced negative.
 */
export async function reverseForReturn(
  tx: Tx,
  input: { tenantId: string; saleId: string; returnId: string; returnedMinor: number; saleEligibleMinor: number; now?: Date },
) {
  const now = input.now ?? new Date();
  const entries = await tx.loyaltyLedgerEntry.findMany({
    where: { tenantId: input.tenantId, saleId: input.saleId, type: { in: ["EARN", "REDEEM"] } },
  });
  const ratio = input.saleEligibleMinor > 0 ? Math.min(1, input.returnedMinor / input.saleEligibleMinor) : 0;
  const result = { reversedEarn: 0, restoredRedeem: 0, unrecovered: 0 };
  for (const e of entries) {
    const key = `${e.type === "EARN" ? "rev-earn" : "rev-redeem"}:${input.returnId}:${e.id}`;
    if (await tx.loyaltyLedgerEntry.findFirst({ where: { tenantId: input.tenantId, idempotencyKey: key } })) continue;
    const scope = { tenantId: e.tenantId, customerId: e.customerId, programId: e.programId };
    const link = { saleId: e.saleId, returnId: input.returnId, sourceEntryId: e.id, idempotencyKey: key };
    await lockCustomer(tx, e.tenantId, e.customerId);
    if (e.type === "EARN") {
      const pts = Math.floor(e.points * ratio);
      if (pts === 0) continue;
      if (e.status === "PENDING") {
        // Not posted yet: the reversal waits with it and is netted when the sale settles.
        await tx.loyaltyLedgerEntry.create({ data: { ...scope, ...link, type: "REVERSE_EARN", status: "PENDING", points: -pts } });
        result.reversedEarn += pts;
        continue;
      }
      const { taken, short } = await consume(tx, scope, pts, now, e.id);
      await tx.loyaltyLedgerEntry.create({
        data: { ...scope, ...link, type: "REVERSE_EARN", points: -(pts - short), allocations: { taken, unrecovered: short } },
      });
      result.reversedEarn += pts - short;
      result.unrecovered += short;
    } else {
      const pts = Math.floor(-e.points * ratio);
      if (pts === 0) continue;
      const lots = (e.allocations as { entryId: string }[] | null) ?? [];
      const source = await tx.loyaltyLedgerEntry.findFirst({
        where: { id: { in: lots.map((l) => l.entryId) } },
        orderBy: { expiresAt: "asc" },
      });
      await tx.loyaltyLedgerEntry.create({
        data: { ...scope, ...link, type: "REVERSE_REDEEM", points: pts, remaining: pts, expiresAt: source?.expiresAt ?? now },
      });
      result.restoredRedeem += pts;
    }
  }
  return result;
}

/** Expire lots past their date: one EXPIRE entry per lot, so the history shows what lapsed. */
export async function expirePoints(input: { tenantId: string; now?: Date }) {
  const now = input.now ?? new Date();
  const lots = await db.loyaltyLedgerEntry.findMany({
    where: { tenantId: input.tenantId, status: "POSTED", remaining: { gt: 0 }, expiresAt: { lte: now } },
  });
  let expired = 0;
  for (const lot of lots) {
    await db.$transaction(async (tx) => {
      await lockCustomer(tx, lot.tenantId, lot.customerId);
      const fresh = await tx.loyaltyLedgerEntry.findUniqueOrThrow({ where: { id: lot.id } });
      if (fresh.remaining === 0) return;
      await tx.loyaltyLedgerEntry.update({ where: { id: lot.id }, data: { remaining: 0 } });
      await tx.loyaltyLedgerEntry.create({
        data: {
          tenantId: lot.tenantId,
          programId: lot.programId,
          customerId: lot.customerId,
          type: "EXPIRE",
          points: -fresh.remaining,
          sourceEntryId: lot.id,
          allocations: [{ entryId: lot.id, points: fresh.remaining }],
          idempotencyKey: `expire:${lot.id}`,
        },
      });
      await writeAuditLogTx(tx, {
        tenantId: lot.tenantId,
        action: "LoyaltyPointsExpired",
        correlationId: randomUUID(),
        metadata: { entryId: lot.id, points: fresh.remaining },
      });
      expired += fresh.remaining;
    });
  }
  return { expired };
}
