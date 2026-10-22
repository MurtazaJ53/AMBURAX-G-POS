import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { writeAuditLog } from "@/server/identity/audit";
import { canSeeEveryone } from "@/server/staff/attendance";
import { blockingLeave } from "@/server/staff/leave";

/**
 * Shift planning (E5, owner 2026-10-14): managers plan shifts up to 14 days ahead, then publish them.
 * A person can't be double-booked. Changing a published shift flags it to the person (there is no
 * SMS/email provider yet, so the flag on their attendance screen is the notice). Approved full-day
 * leave or unavailability (server/staff/leave.ts) blocks a shift on those days.
 */

export const PLAN_HORIZON_DAYS = 14;
const MAX_SHIFT_HOURS = 16;

type Actor = { tenantId: string; userId: string; tenantRole: "OWNER" | "STAFF" };
export type PlanResult =
  | { status: "ok"; id?: string }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "validation_error"; reason: string };

async function check(
  actor: Actor,
  storeId: string,
  userId: string,
  startAt: Date,
  endAt: Date,
  breakMinutes: number,
  excludeId?: string,
): Promise<PlanResult | null> {
  if (!(await canSeeEveryone(actor, storeId))) return { status: "forbidden" };
  const now = Date.now();
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return { status: "validation_error", reason: "Enter a start and end time." };
  }
  if (startAt.getTime() < now - 3_600_000) return { status: "validation_error", reason: "A shift can't start in the past." };
  if (startAt.getTime() > now + PLAN_HORIZON_DAYS * 86_400_000) {
    return { status: "validation_error", reason: `Plan up to ${PLAN_HORIZON_DAYS} days ahead.` };
  }
  const hours = (endAt.getTime() - startAt.getTime()) / 3_600_000;
  if (hours <= 0 || hours > MAX_SHIFT_HOURS) {
    return { status: "validation_error", reason: "A shift must end after it starts, within 16 hours." };
  }
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes >= hours * 60) {
    return { status: "validation_error", reason: "The break must be shorter than the shift." };
  }
  const member = await db.storeMembership.count({ where: { tenantId: actor.tenantId, storeId, userId } });
  if (member !== 1) return { status: "validation_error", reason: "That person doesn't work in this store." };
  const clash = await db.shiftPlan.count({
    where: {
      tenantId: actor.tenantId,
      userId,
      status: { not: "CANCELLED" },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  if (clash > 0) return { status: "validation_error", reason: "That person already has a shift at that time." };
  const away = await blockingLeave(actor.tenantId, userId, startAt, endAt);
  if (away) {
    const what = away.kind === "UNAVAILABLE" ? "unavailable" : "on approved leave";
    const span = away.fromDate === away.toDate ? away.fromDate : `${away.fromDate} to ${away.toDate}`;
    return { status: "validation_error", reason: `That person is ${what} (${span}).` };
  }
  return null;
}

export async function createShift(input: {
  actor: Actor;
  storeId: string;
  userId: string;
  startAt: Date;
  endAt: Date;
  breakMinutes: number;
  notes?: string | null;
}): Promise<PlanResult> {
  const refused = await check(input.actor, input.storeId, input.userId, input.startAt, input.endAt, input.breakMinutes);
  if (refused) return refused;
  const plan = await db.shiftPlan.create({
    data: {
      tenantId: input.actor.tenantId,
      storeId: input.storeId,
      userId: input.userId,
      startAt: input.startAt,
      endAt: input.endAt,
      breakMinutes: input.breakMinutes,
      notes: input.notes?.trim().slice(0, 200) || null,
      createdByUserId: input.actor.userId,
    },
  });
  await writeAuditLog({
    tenantId: input.actor.tenantId,
    userId: input.actor.userId,
    action: "ShiftPlanned",
    correlationId: randomUUID(),
    metadata: { shiftId: plan.id, userId: input.userId },
  });
  return { status: "ok", id: plan.id };
}

/** Change a shift; if it was already published the person is flagged about the change. */
export async function updateShift(input: {
  actor: Actor;
  shiftId: string;
  startAt: Date;
  endAt: Date;
  breakMinutes: number;
}): Promise<PlanResult> {
  const plan = await db.shiftPlan.findFirst({
    where: { id: input.shiftId, tenantId: input.actor.tenantId, status: { not: "CANCELLED" } },
  });
  if (!plan) return { status: "not_found" };
  const refused = await check(input.actor, plan.storeId, plan.userId, input.startAt, input.endAt, input.breakMinutes, plan.id);
  if (refused) return refused;
  await db.shiftPlan.update({
    where: { id: plan.id },
    data: {
      startAt: input.startAt,
      endAt: input.endAt,
      breakMinutes: input.breakMinutes,
      ...(plan.status === "PUBLISHED" ? { changedAfterPublishAt: new Date() } : {}),
    },
  });
  await writeAuditLog({
    tenantId: input.actor.tenantId,
    userId: input.actor.userId,
    action: "ShiftChanged",
    correlationId: randomUUID(),
    metadata: { shiftId: plan.id, wasPublished: plan.status === "PUBLISHED" },
  });
  return { status: "ok", id: plan.id };
}

export async function cancelShift(input: { actor: Actor; shiftId: string }): Promise<PlanResult> {
  const plan = await db.shiftPlan.findFirst({
    where: { id: input.shiftId, tenantId: input.actor.tenantId, status: { not: "CANCELLED" } },
  });
  if (!plan) return { status: "not_found" };
  if (!(await canSeeEveryone(input.actor, plan.storeId))) return { status: "forbidden" };
  await db.shiftPlan.update({
    where: { id: plan.id },
    data: { status: "CANCELLED", ...(plan.status === "PUBLISHED" ? { changedAfterPublishAt: new Date() } : {}) },
  });
  await writeAuditLog({
    tenantId: input.actor.tenantId,
    userId: input.actor.userId,
    action: "ShiftCancelled",
    correlationId: randomUUID(),
    metadata: { shiftId: plan.id },
  });
  return { status: "ok" };
}

/** Publish every draft shift in the store (the manager's approval step). */
export async function publishShifts(input: {
  actor: Actor;
  storeId: string;
}): Promise<{ status: "ok"; published: number } | { status: "forbidden" }> {
  if (!(await canSeeEveryone(input.actor, input.storeId))) return { status: "forbidden" };
  const res = await db.shiftPlan.updateMany({
    where: { tenantId: input.actor.tenantId, storeId: input.storeId, status: "DRAFT" },
    data: { status: "PUBLISHED", publishedAt: new Date(), publishedByUserId: input.actor.userId },
  });
  await writeAuditLog({
    tenantId: input.actor.tenantId,
    userId: input.actor.userId,
    action: "ShiftsPublished",
    correlationId: randomUUID(),
    metadata: { storeId: input.storeId, count: res.count },
  });
  return { status: "ok", published: res.count };
}

/** Shifts in a window, with names. Staff see only published ones. */
export async function listPlans(params: {
  tenantId: string;
  storeId: string;
  from: Date;
  to: Date;
  includeDrafts: boolean;
  onlyUserId?: string;
}) {
  const plans = await db.shiftPlan.findMany({
    where: {
      tenantId: params.tenantId,
      storeId: params.storeId,
      startAt: { gte: params.from, lt: params.to },
      status: params.includeDrafts ? { not: "CANCELLED" } : "PUBLISHED",
      ...(params.onlyUserId ? { userId: params.onlyUserId } : {}),
    },
    orderBy: { startAt: "asc" },
  });
  const users = await db.user.findMany({
    where: { tenantId: params.tenantId, id: { in: [...new Set(plans.map((p) => p.userId))] } },
    select: { id: true, name: true },
  });
  const name = new Map(users.map((u) => [u.id, u.name]));
  return plans.map((p) => ({ ...p, name: name.get(p.userId) ?? "" }));
}
