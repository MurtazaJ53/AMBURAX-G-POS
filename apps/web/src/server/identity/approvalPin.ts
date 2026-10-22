import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { writeAuditLog } from "@/server/identity/audit";
import { hashPassword, TIMING_SAFETY_DUMMY_HASH, verifyPassword } from "@/server/identity/password";

/**
 * Manager approval PIN (owner choice 2026-10-14).
 *
 * A cashier's discount above their limit is approved at the till by an owner or store manager
 * typing their own 4-6 digit PIN. The PIN is bcrypt-hashed like a password, set only after the
 * manager re-enters their password, and locks for 15 minutes after 5 wrong tries so it cannot
 * be guessed at a counter. Every set and every lockout is audited.
 */

export const PIN_PATTERN = /^\d{4,6}$/;
export const MAX_PIN_FAILURES = 5;
export const PIN_LOCK_MINUTES = 15;

/** Who may approve in a store: the tenant owner, or that store's manager. */
export async function canApproveInStore(params: { tenantId: string; storeId: string; userId: string }): Promise<boolean> {
  const user = await db.user.findFirst({
    where: { id: params.userId, tenantId: params.tenantId, status: "ACTIVE" },
    select: { tenantRole: true },
  });
  if (!user) return false;
  if (user.tenantRole === "OWNER") return true;
  const membership = await db.storeMembership.findUnique({
    where: { userId_storeId: { userId: params.userId, storeId: params.storeId } },
    select: { role: true },
  });
  return membership?.role === "STORE_MANAGER";
}

/** Approvers for the till's picker: eligible in this store and with a PIN set. Names only. */
export async function listApprovers(params: { tenantId: string; storeId: string }): Promise<{ id: string; name: string }[]> {
  return db.user.findMany({
    where: {
      tenantId: params.tenantId,
      status: "ACTIVE",
      approvalPinHash: { not: null },
      OR: [
        { tenantRole: "OWNER" },
        { memberships: { some: { storeId: params.storeId, role: "STORE_MANAGER" } } },
      ],
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** Active and allowed in this store: the owner, or anyone with a membership there. */
export async function worksInStore(params: { tenantId: string; storeId: string; userId: string }): Promise<boolean> {
  const user = await db.user.findFirst({
    where: { id: params.userId, tenantId: params.tenantId, status: "ACTIVE" },
    select: { tenantRole: true },
  });
  if (!user) return false;
  if (user.tenantRole === "OWNER") return true;
  const membership = await db.storeMembership.findUnique({
    where: { userId_storeId: { userId: params.userId, storeId: params.storeId } },
    select: { role: true },
  });
  return Boolean(membership);
}

/** Why a PIN is unacceptable, or null. */
export function pinProblem(pin: string): string | null {
  if (!PIN_PATTERN.test(pin)) return "A PIN is 4 to 6 digits.";
  if (/^(\d)\1+$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin)) {
    return "Choose a PIN that is not a repeated or running sequence.";
  }
  return null;
}

/**
 * An owner or store manager sets (or clears, with `pin: null`) a team member's PIN — the way a
 * small shop hands each salesman their till PIN. The owner's PIN is only ever set by the owner.
 * Audited; the PIN itself is never stored or logged in clear.
 */
export async function setPinForStaff(params: {
  tenantId: string;
  storeId: string;
  actorUserId: string;
  targetUserId: string;
  pin: string | null;
}): Promise<SetPinResult> {
  if (!(await canApproveInStore({ tenantId: params.tenantId, storeId: params.storeId, userId: params.actorUserId }))) {
    return { status: "forbidden" };
  }
  const target = await db.user.findFirst({
    where: { id: params.targetUserId, tenantId: params.tenantId },
    select: { tenantRole: true },
  });
  if (!target || !(await worksInStore({ tenantId: params.tenantId, storeId: params.storeId, userId: params.targetUserId }))) {
    return { status: "forbidden" };
  }
  if (target.tenantRole === "OWNER" && params.targetUserId !== params.actorUserId) return { status: "forbidden" };
  if (params.pin !== null) {
    const weak = pinProblem(params.pin);
    if (weak) return { status: "invalid_pin", reason: weak };
  }
  await db.user.update({
    where: { id: params.targetUserId },
    data: {
      approvalPinHash: params.pin === null ? null : await hashPassword(params.pin),
      approvalPinFailures: 0,
      approvalPinLockedUntil: null,
    },
  });
  await writeAuditLog({
    tenantId: params.tenantId,
    userId: params.actorUserId,
    action: params.pin === null ? "staff_pin.cleared" : "staff_pin.set",
    correlationId: randomUUID(),
    metadata: { targetUserId: params.targetUserId, storeId: params.storeId },
  });
  return { status: "ok" };
}

export async function hasApprovalPin(userId: string): Promise<boolean> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { approvalPinHash: true } });
  return Boolean(user?.approvalPinHash);
}

export type SetPinResult =
  | { status: "ok" }
  | { status: "forbidden" }
  | { status: "wrong_password" }
  | { status: "invalid_pin"; reason: string };

export async function setApprovalPin(params: {
  tenantId: string;
  userId: string;
  storeId: string;
  currentPassword: string;
  pin: string;
}): Promise<SetPinResult> {
  // One personal PIN per person: it switches the shared till to them, and for an owner or store
  // manager it also approves discounts (approval re-checks the role every time it is used).
  if (!(await worksInStore(params))) return { status: "forbidden" };
  const weak = pinProblem(params.pin);
  if (weak) return { status: "invalid_pin", reason: weak };
  const user = await db.user.findFirst({
    where: { id: params.userId, tenantId: params.tenantId },
    select: { passwordHash: true },
  });
  if (!user || !(await verifyPassword(params.currentPassword, user.passwordHash))) return { status: "wrong_password" };

  await db.user.update({
    where: { id: params.userId },
    data: { approvalPinHash: await hashPassword(params.pin), approvalPinFailures: 0, approvalPinLockedUntil: null },
  });
  await writeAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    action: "approval_pin.set",
    correlationId: randomUUID(),
  });
  return { status: "ok" };
}

export type VerifyPinResult =
  | { status: "ok" }
  | { status: "not_allowed" }
  | { status: "locked"; until: Date }
  | { status: "wrong_pin"; attemptsLeft: number };

/**
 * Check an approver's PIN. A wrong PIN counts against the approver, not the cashier, and the
 * same answer is given for "not an approver here" and "no PIN set" so the till learns nothing.
 */
export async function verifyApprovalPin(params: {
  tenantId: string;
  storeId: string;
  approverUserId: string;
  pin: string;
  now?: Date;
}): Promise<VerifyPinResult> {
  const eligible = await canApproveInStore({
    tenantId: params.tenantId,
    storeId: params.storeId,
    userId: params.approverUserId,
  });
  return verifyUserPin({ tenantId: params.tenantId, storeId: params.storeId, userId: params.approverUserId, pin: params.pin, eligible, now: params.now });
}

/**
 * Check a person's own PIN once the caller has decided they are `eligible` for what it is being
 * used for (approving a discount, or taking over the shared till). Same lockout and timing rules.
 */
export async function verifyUserPin(params: {
  tenantId: string;
  storeId: string;
  userId: string;
  pin: string;
  eligible: boolean;
  now?: Date;
}): Promise<VerifyPinResult> {
  const now = params.now ?? new Date();
  const approverUserId = params.userId;
  const user = params.eligible
    ? await db.user.findFirst({
        where: { id: approverUserId, tenantId: params.tenantId },
        select: { approvalPinHash: true, approvalPinFailures: true, approvalPinLockedUntil: true },
      })
    : null;
  if (!user?.approvalPinHash) {
    // Burn the same bcrypt cost as a real check, so timing does not reveal who has a PIN.
    await verifyPassword(params.pin, TIMING_SAFETY_DUMMY_HASH);
    return { status: "not_allowed" };
  }
  if (user.approvalPinLockedUntil && user.approvalPinLockedUntil > now) {
    return { status: "locked", until: user.approvalPinLockedUntil };
  }

  if (PIN_PATTERN.test(params.pin) && (await verifyPassword(params.pin, user.approvalPinHash))) {
    if (user.approvalPinFailures > 0 || user.approvalPinLockedUntil) {
      await db.user.update({
        where: { id: approverUserId },
        data: { approvalPinFailures: 0, approvalPinLockedUntil: null },
      });
    }
    return { status: "ok" };
  }

  // Counted in PostgreSQL so two wrong tries at once cannot both read the old count. An expired
  // lock starts the count again.
  const rows = await db.$queryRaw<{ approvalPinFailures: number }[]>`
    UPDATE "users"
       SET "approvalPinFailures" = CASE
             WHEN "approvalPinLockedUntil" IS NOT NULL AND "approvalPinLockedUntil" <= ${now} THEN 1
             ELSE "approvalPinFailures" + 1
           END,
           "approvalPinLockedUntil" = CASE
             WHEN "approvalPinLockedUntil" IS NOT NULL AND "approvalPinLockedUntil" <= ${now} THEN NULL
             ELSE "approvalPinLockedUntil"
           END
     WHERE "id" = ${approverUserId} AND "tenantId" = ${params.tenantId}
    RETURNING "approvalPinFailures"
  `;
  const failures = rows[0]?.approvalPinFailures ?? MAX_PIN_FAILURES;
  if (failures >= MAX_PIN_FAILURES) {
    const until = new Date(now.getTime() + PIN_LOCK_MINUTES * 60_000);
    await db.user.update({ where: { id: approverUserId }, data: { approvalPinLockedUntil: until } });
    await writeAuditLog({
      tenantId: params.tenantId,
      userId: approverUserId,
      action: "approval_pin.locked",
      correlationId: randomUUID(),
      metadata: { storeId: params.storeId },
    });
    return { status: "locked", until };
  }
  return { status: "wrong_pin", attemptsLeft: MAX_PIN_FAILURES - failures };
}
