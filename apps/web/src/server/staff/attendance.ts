import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { writeAuditLog } from "@/server/identity/audit";
import { istDay } from "@/server/pos/cashRegister";

/**
 * Attendance (screen 51): people clock themselves in and out of the store they are working in.
 * Rows mirror ERPNext HRMS Employee Checkin (log_type IN/OUT, time) so they can sync once HRMS is
 * on the site.
 *
 * E5 (owner 2026-10-14): corrections go through a request a manager approves (never their own); the
 * original punch is kept and only marked voided. Against the person's published shift: late after the
 * store's grace (default 10 minutes); half day when worked time is under the store's percentage
 * (default 50%) of the scheduled paid time; missing or unpaired punches are flagged for review, never
 * guessed.
 */

type Actor = { tenantId: string; userId: string; tenantRole: "OWNER" | "STAFF" };

/** Two taps within this window are one tap. */
const DEBOUNCE_MS = 60_000;

export type CheckinResult =
  | { status: "ok"; logType: "IN" | "OUT" }
  | { status: "forbidden" }
  | { status: "conflict"; reason: string };

async function worksHere(actor: Actor, storeId: string): Promise<boolean> {
  if (actor.tenantRole === "OWNER") {
    return (await db.store.count({ where: { id: storeId, tenantId: actor.tenantId } })) === 1;
  }
  return (await db.storeMembership.count({ where: { tenantId: actor.tenantId, userId: actor.userId, storeId } })) === 1;
}

export async function canSeeEveryone(actor: Actor, storeId: string): Promise<boolean> {
  if (actor.tenantRole === "OWNER") return true;
  const m = await db.storeMembership.findFirst({
    where: { tenantId: actor.tenantId, userId: actor.userId, storeId },
    select: { role: true },
  });
  return m?.role === "STORE_MANAGER";
}

/** Clock the actor in or out. The direction must follow their last punch today. */
export async function punch(input: { actor: Actor; storeId: string; logType: "IN" | "OUT"; now?: Date }): Promise<CheckinResult> {
  const { actor } = input;
  if (!(await worksHere(actor, input.storeId))) return { status: "forbidden" };
  const now = input.now ?? new Date();
  const { from } = istDay(new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10));
  const last = await db.staffCheckin.findFirst({
    where: { tenantId: actor.tenantId, userId: actor.userId, storeId: input.storeId, at: { gte: from } },
    orderBy: { at: "desc" },
    select: { logType: true, at: true },
  });
  if (last && last.logType === input.logType) {
    if (now.getTime() - last.at.getTime() < DEBOUNCE_MS) return { status: "ok", logType: input.logType };
    return { status: "conflict", reason: input.logType === "IN" ? "You're already clocked in." : "You're already clocked out." };
  }
  if (!last && input.logType === "OUT") return { status: "conflict", reason: "Clock in first." };

  await db.staffCheckin.create({
    data: { tenantId: actor.tenantId, storeId: input.storeId, userId: actor.userId, logType: input.logType, at: now },
  });
  await writeAuditLog({
    tenantId: actor.tenantId,
    userId: actor.userId,
    action: input.logType === "IN" ? "StaffClockedIn" : "StaffClockedOut",
    correlationId: randomUUID(),
    metadata: { storeId: input.storeId },
  });
  return { status: "ok", logType: input.logType };
}

export type AttendanceFlag = "LATE" | "HALF_DAY" | "NEEDS_REVIEW" | "ABSENT";

export interface RosterRow {
  userId: string;
  name: string;
  role: string;
  state: "in" | "out" | "absent";
  firstIn: Date | null;
  lastOut: Date | null;
  minutes: number;
  punches: { id: string; logType: "IN" | "OUT"; at: Date; source: string }[];
  shift: { startAt: Date; endAt: Date; breakMinutes: number; changedAfterPublishAt: Date | null } | null;
  flags: AttendanceFlag[];
}

/** E5 flags for one person's day against their published shift. Pure, so it is unit-testable. */
export function attendanceFlags(input: {
  punches: { logType: "IN" | "OUT"; at: Date }[];
  shift: { startAt: Date; endAt: Date; breakMinutes: number } | null;
  minutes: number;
  graceMinutes: number;
  halfDayPercent: number;
  now: Date;
}): AttendanceFlag[] {
  const flags: AttendanceFlag[] = [];
  const firstIn = input.punches.find((p) => p.logType === "IN");
  const ended = input.shift ? input.now >= input.shift.endAt : false;
  if (input.shift && firstIn && firstIn.at.getTime() > input.shift.startAt.getTime() + input.graceMinutes * 60_000) {
    flags.push("LATE");
  }
  // Unpaired punches once the shift is over, or an OUT with no IN before it.
  let open = false;
  let broken = false;
  for (const p of input.punches) {
    if (p.logType === "IN") {
      if (open) broken = true;
      open = true;
    } else {
      if (!open) broken = true;
      open = false;
    }
  }
  if (broken || (open && ended)) flags.push("NEEDS_REVIEW");
  if (input.shift && ended) {
    if (input.punches.length === 0) flags.push("ABSENT");
    else if (!broken && !open) {
      const paid = (input.shift.endAt.getTime() - input.shift.startAt.getTime()) / 60_000 - input.shift.breakMinutes;
      if (paid > 0 && input.minutes < (paid * input.halfDayPercent) / 100) flags.push("HALF_DAY");
    }
  }
  return flags;
}

/** Minutes between IN/OUT pairs; an IN still open counts up to `until`. */
export function workedMinutes(punches: { logType: "IN" | "OUT"; at: Date }[], until: Date): number {
  let total = 0;
  let openIn: Date | null = null;
  for (const p of punches) {
    if (p.logType === "IN") openIn ??= p.at;
    else if (openIn) {
      total += p.at.getTime() - openIn.getTime();
      openIn = null;
    }
  }
  if (openIn) total += Math.max(0, until.getTime() - openIn.getTime());
  return Math.floor(total / 60_000);
}

export async function roster(params: { tenantId: string; storeId: string; date: string; onlyUserId?: string; now?: Date }) {
  const { from, to } = istDay(params.date);
  const until = new Date(Math.min((params.now ?? new Date()).getTime(), to.getTime()));
  const [members, punches, store, shifts] = await Promise.all([
    db.storeMembership.findMany({
      where: { tenantId: params.tenantId, storeId: params.storeId, ...(params.onlyUserId ? { userId: params.onlyUserId } : {}) },
      orderBy: { user: { name: "asc" } },
      select: { role: true, user: { select: { id: true, name: true } } },
    }),
    db.staffCheckin.findMany({
      where: {
        tenantId: params.tenantId,
        storeId: params.storeId,
        at: { gte: from, lt: to },
        // A punch replaced by an approved correction is kept but no longer counts.
        voidedByCorrectionId: null,
        ...(params.onlyUserId ? { userId: params.onlyUserId } : {}),
      },
      orderBy: { at: "asc" },
      select: { id: true, userId: true, logType: true, at: true, source: true },
    }),
    db.store.findFirst({ where: { id: params.storeId, tenantId: params.tenantId }, select: { lateGraceMinutes: true, halfDayPercent: true } }),
    db.shiftPlan.findMany({
      where: {
        tenantId: params.tenantId,
        storeId: params.storeId,
        status: "PUBLISHED",
        startAt: { gte: from, lt: to },
        ...(params.onlyUserId ? { userId: params.onlyUserId } : {}),
      },
      orderBy: { startAt: "asc" },
    }),
  ]);
  const nowAt = params.now ?? new Date();
  return members.map<RosterRow>((m) => {
    const mine = punches.filter((p) => p.userId === m.user.id);
    const last = mine.at(-1);
    const minutes = workedMinutes(mine, until);
    const plan = shifts.find((sh) => sh.userId === m.user.id) ?? null;
    const shift = plan
      ? { startAt: plan.startAt, endAt: plan.endAt, breakMinutes: plan.breakMinutes, changedAfterPublishAt: plan.changedAfterPublishAt }
      : null;
    return {
      userId: m.user.id,
      name: m.user.name,
      role: m.role,
      state: !last ? "absent" : last.logType === "IN" ? "in" : "out",
      firstIn: mine.find((p) => p.logType === "IN")?.at ?? null,
      lastOut: [...mine].reverse().find((p) => p.logType === "OUT")?.at ?? null,
      minutes,
      punches: mine.map((p) => ({ id: p.id, logType: p.logType, at: p.at, source: p.source })),
      shift,
      flags: attendanceFlags({
        punches: mine,
        shift,
        minutes,
        graceMinutes: store?.lateGraceMinutes ?? 10,
        halfDayPercent: store?.halfDayPercent ?? 50,
        now: nowAt,
      }),
    };
  });
}

export type CorrectionResult =
  | { status: "ok"; id?: string }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "conflict"; reason: string }
  | { status: "validation_error"; reason: string };

/**
 * Ask for an attendance correction (E5): add a missing punch, or replace a wrong one. Anyone may ask
 * for their own; a manager may ask on someone's behalf. It changes nothing until approved.
 */
export async function requestCorrection(input: {
  actor: Actor;
  storeId: string;
  userId: string;
  logType: "IN" | "OUT";
  correctedAt: Date;
  originalCheckinId?: string | null;
  reason: string;
  now?: Date;
}): Promise<CorrectionResult> {
  const now = input.now ?? new Date();
  const reason = input.reason.trim().replace(/\s+/g, " ");
  if (reason.length < 3 || reason.length > 200) return { status: "validation_error", reason: "Say why the time needs correcting." };
  if (Number.isNaN(input.correctedAt.getTime()) || input.correctedAt > now) {
    return { status: "validation_error", reason: "The corrected time can't be in the future." };
  }
  if (now.getTime() - input.correctedAt.getTime() > 31 * 86_400_000) {
    return { status: "validation_error", reason: "Corrections can go back 31 days." };
  }
  const forSelf = input.userId === input.actor.userId;
  if (!forSelf && !(await canSeeEveryone(input.actor, input.storeId))) return { status: "forbidden" };
  const member = await db.storeMembership.count({
    where: { tenantId: input.actor.tenantId, userId: input.userId, storeId: input.storeId },
  });
  const ownerSelf = forSelf && input.actor.tenantRole === "OWNER";
  if (member !== 1 && !ownerSelf) return { status: "validation_error", reason: "That person doesn't work in this store." };
  if (input.originalCheckinId) {
    const original = await db.staffCheckin.findFirst({
      where: {
        id: input.originalCheckinId,
        tenantId: input.actor.tenantId,
        userId: input.userId,
        storeId: input.storeId,
        voidedByCorrectionId: null,
      },
    });
    if (!original) return { status: "not_found" };
  }
  const c = await db.punchCorrection.create({
    data: {
      tenantId: input.actor.tenantId,
      storeId: input.storeId,
      userId: input.userId,
      requestedByUserId: input.actor.userId,
      originalCheckinId: input.originalCheckinId ?? null,
      logType: input.logType,
      correctedAt: input.correctedAt,
      reason,
    },
  });
  await writeAuditLog({
    tenantId: input.actor.tenantId,
    userId: input.actor.userId,
    action: "PunchCorrectionRequested",
    correlationId: randomUUID(),
    metadata: { correctionId: c.id, userId: input.userId },
  });
  return { status: "ok", id: c.id };
}

/**
 * Approve or reject a correction (E5). Only the owner or a store manager, never for their own punch
 * and never for a request they made. Approval adds a CORRECTION punch and voids the replaced one;
 * nothing is overwritten or deleted.
 */
export async function decideCorrection(input: {
  actor: Actor;
  correctionId: string;
  approve: boolean;
  note: string;
}): Promise<CorrectionResult> {
  const note = input.note.trim().replace(/\s+/g, " ");
  if (note.length < 3 || note.length > 200) return { status: "validation_error", reason: "Add a note for the decision." };
  const c = await db.punchCorrection.findFirst({ where: { id: input.correctionId, tenantId: input.actor.tenantId } });
  if (!c) return { status: "not_found" };
  if (!(await canSeeEveryone(input.actor, c.storeId))) return { status: "forbidden" };
  if (input.actor.userId === c.userId || input.actor.userId === c.requestedByUserId) {
    return { status: "conflict", reason: "Someone else has to decide this correction." };
  }
  if (c.status !== "PENDING") return { status: "conflict", reason: "This correction was already decided." };
  const done = await db.$transaction(async (tx) => {
    const claimed = await tx.punchCorrection.updateMany({
      where: { id: c.id, status: "PENDING" },
      data: {
        status: input.approve ? "APPROVED" : "REJECTED",
        decidedByUserId: input.actor.userId,
        decidedAt: new Date(),
        decisionNote: note,
      },
    });
    if (claimed.count !== 1) return false;
    if (input.approve) {
      const punch = await tx.staffCheckin.create({
        data: { tenantId: c.tenantId, storeId: c.storeId, userId: c.userId, logType: c.logType, at: c.correctedAt, source: "CORRECTION" },
      });
      if (c.originalCheckinId) {
        await tx.staffCheckin.updateMany({
          where: { id: c.originalCheckinId, voidedByCorrectionId: null },
          data: { voidedByCorrectionId: c.id },
        });
      }
      await tx.punchCorrection.update({ where: { id: c.id }, data: { appliedCheckinId: punch.id } });
    }
    return true;
  });
  if (!done) return { status: "conflict", reason: "This correction was already decided." };
  await writeAuditLog({
    tenantId: input.actor.tenantId,
    userId: input.actor.userId,
    action: input.approve ? "PunchCorrectionApproved" : "PunchCorrectionRejected",
    correlationId: randomUUID(),
    metadata: { correctionId: c.id, userId: c.userId, note },
  });
  return { status: "ok" };
}

export async function listCorrections(params: { tenantId: string; storeId: string; onlyUserId?: string }) {
  const rows = await db.punchCorrection.findMany({
    where: { tenantId: params.tenantId, storeId: params.storeId, ...(params.onlyUserId ? { userId: params.onlyUserId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const users = await db.user.findMany({
    where: { tenantId: params.tenantId, id: { in: [...new Set(rows.flatMap((r) => [r.userId, r.requestedByUserId]))] } },
    select: { id: true, name: true },
  });
  const name = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...r, name: name.get(r.userId) ?? "", requestedBy: name.get(r.requestedByUserId) ?? "" }));
}

