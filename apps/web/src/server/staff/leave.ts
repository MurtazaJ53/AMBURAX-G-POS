import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { writeAuditLog } from "@/server/identity/audit";
import { canSeeEveryone } from "@/server/staff/attendance";

/**
 * Leave and unavailability (E5). Anyone asks for their own; a manager may ask for someone else.
 * Someone other than the person approves. Approved leave and unavailability block shift planning on
 * those days. Shaped like HRMS Leave Application so it can move there later (latter.md).
 */

type Actor = { tenantId: string; userId: string; tenantRole: "OWNER" | "STAFF" };
export type LeaveResult =
  | { status: "ok"; id?: string }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "conflict"; reason: string }
  | { status: "validation_error"; reason: string };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 60;

/** IST calendar day of an instant. */
export function istDate(at: Date): string {
  return new Date(at.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

export async function requestLeave(input: {
  actor: Actor;
  storeId: string;
  userId: string;
  kind: "LEAVE" | "UNAVAILABLE";
  fromDate: string;
  toDate: string;
  halfDay?: boolean;
  reason: string;
}): Promise<LeaveResult> {
  const reason = input.reason.trim().replace(/\s+/g, " ");
  if (!DAY_RE.test(input.fromDate) || !DAY_RE.test(input.toDate) || input.fromDate > input.toDate) {
    return { status: "validation_error", reason: "Choose a from and to date, in order." };
  }
  const days = (Date.parse(input.toDate) - Date.parse(input.fromDate)) / 86_400_000 + 1;
  if (days > MAX_DAYS) return { status: "validation_error", reason: `Ask for at most ${MAX_DAYS} days at once.` };
  if (input.halfDay && input.fromDate !== input.toDate) {
    return { status: "validation_error", reason: "A half day is a single date." };
  }
  if (reason.length < 3 || reason.length > 200) return { status: "validation_error", reason: "Add a short reason." };
  const forSelf = input.userId === input.actor.userId;
  if (!forSelf && !(await canSeeEveryone(input.actor, input.storeId))) return { status: "forbidden" };
  const member = await db.storeMembership.count({ where: { tenantId: input.actor.tenantId, storeId: input.storeId, userId: input.userId } });
  if (member !== 1) return { status: "validation_error", reason: "That person doesn't work in this store." };
  const overlap = await db.staffLeave.count({
    where: {
      tenantId: input.actor.tenantId,
      userId: input.userId,
      status: { in: ["PENDING", "APPROVED"] },
      fromDate: { lte: input.toDate },
      toDate: { gte: input.fromDate },
    },
  });
  if (overlap > 0) return { status: "conflict", reason: "There is already a request covering those dates." };
  const row = await db.staffLeave.create({
    data: {
      tenantId: input.actor.tenantId,
      storeId: input.storeId,
      userId: input.userId,
      kind: input.kind,
      fromDate: input.fromDate,
      toDate: input.toDate,
      halfDay: Boolean(input.halfDay),
      reason,
      requestedByUserId: input.actor.userId,
    },
  });
  await writeAuditLog({
    tenantId: input.actor.tenantId,
    userId: input.actor.userId,
    action: "LeaveRequested",
    correlationId: randomUUID(),
    metadata: { leaveId: row.id, userId: input.userId, kind: input.kind, fromDate: input.fromDate, toDate: input.toDate },
  });
  return { status: "ok", id: row.id };
}

/**
 * Approve or reject (manager, never the person or the requester). Approving is refused while the
 * person still has a planned shift in those dates — cancel or move it first; nothing changes silently.
 */
export async function decideLeave(input: { actor: Actor; leaveId: string; approve: boolean; note: string }): Promise<LeaveResult> {
  const note = input.note.trim().replace(/\s+/g, " ");
  if (note.length < 3 || note.length > 200) return { status: "validation_error", reason: "Add a note for the decision." };
  const l = await db.staffLeave.findFirst({ where: { id: input.leaveId, tenantId: input.actor.tenantId } });
  if (!l) return { status: "not_found" };
  if (!(await canSeeEveryone(input.actor, l.storeId))) return { status: "forbidden" };
  if (input.actor.userId === l.userId || input.actor.userId === l.requestedByUserId) {
    return { status: "conflict", reason: "Someone else has to decide this request." };
  }
  if (l.status !== "PENDING") return { status: "conflict", reason: "This request was already decided." };
  if (input.approve && !l.halfDay) {
    const clash = await db.shiftPlan.count({
      where: {
        tenantId: l.tenantId,
        userId: l.userId,
        status: { not: "CANCELLED" },
        startAt: {
          gte: new Date(`${l.fromDate}T00:00:00+05:30`),
          lt: new Date(Date.parse(`${l.toDate}T00:00:00+05:30`) + 86_400_000),
        },
      },
    });
    if (clash > 0) {
      return { status: "conflict", reason: `They have ${clash} planned ${clash === 1 ? "shift" : "shifts"} in those dates. Cancel or move them first.` };
    }
  }
  const claimed = await db.staffLeave.updateMany({
    where: { id: l.id, status: "PENDING" },
    data: { status: input.approve ? "APPROVED" : "REJECTED", decidedByUserId: input.actor.userId, decidedAt: new Date(), decisionNote: note },
  });
  if (claimed.count !== 1) return { status: "conflict", reason: "This request was already decided." };
  await writeAuditLog({
    tenantId: input.actor.tenantId,
    userId: input.actor.userId,
    action: input.approve ? "LeaveApproved" : "LeaveRejected",
    correlationId: randomUUID(),
    metadata: { leaveId: l.id, userId: l.userId, note },
  });
  return { status: "ok" };
}

/** The person (or a manager) withdraws a request that hasn't started. */
export async function cancelLeave(input: { actor: Actor; leaveId: string; today?: string }): Promise<LeaveResult> {
  const l = await db.staffLeave.findFirst({ where: { id: input.leaveId, tenantId: input.actor.tenantId } });
  if (!l) return { status: "not_found" };
  if (l.userId !== input.actor.userId && !(await canSeeEveryone(input.actor, l.storeId))) return { status: "forbidden" };
  if (l.status !== "PENDING" && l.status !== "APPROVED") return { status: "conflict", reason: "This request is already closed." };
  if (l.fromDate <= (input.today ?? istDate(new Date()))) {
    return { status: "conflict", reason: "Leave that has started can't be withdrawn here." };
  }
  await db.staffLeave.update({ where: { id: l.id }, data: { status: "CANCELLED" } });
  await writeAuditLog({
    tenantId: input.actor.tenantId,
    userId: input.actor.userId,
    action: "LeaveCancelled",
    correlationId: randomUUID(),
    metadata: { leaveId: l.id },
  });
  return { status: "ok" };
}

/**
 * For shift planning: approved full-day leave or unavailability that overlaps a shift for this person,
 * if any. Half-day leave doesn't block; the manager plans around it.
 */
export async function blockingLeave(tenantId: string, userId: string, startAt: Date, endAt: Date) {
  return db.staffLeave.findFirst({
    where: {
      tenantId,
      userId,
      status: "APPROVED",
      halfDay: false,
      fromDate: { lte: istDate(new Date(endAt.getTime() - 1)) },
      toDate: { gte: istDate(startAt) },
    },
    select: { kind: true, fromDate: true, toDate: true },
  });
}

export async function listLeave(params: { tenantId: string; storeId: string; onlyUserId?: string; fromDate: string }) {
  const rows = await db.staffLeave.findMany({
    where: {
      tenantId: params.tenantId,
      storeId: params.storeId,
      toDate: { gte: params.fromDate },
      status: { not: "CANCELLED" },
      ...(params.onlyUserId ? { userId: params.onlyUserId } : {}),
    },
    orderBy: [{ fromDate: "asc" }, { createdAt: "asc" }],
    take: 100,
  });
  const users = await db.user.findMany({
    where: { tenantId: params.tenantId, id: { in: [...new Set(rows.flatMap((r) => [r.userId, r.requestedByUserId]))] } },
    select: { id: true, name: true },
  });
  const name = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...r, name: name.get(r.userId) ?? "", requestedBy: name.get(r.requestedByUserId) ?? "" }));
}
