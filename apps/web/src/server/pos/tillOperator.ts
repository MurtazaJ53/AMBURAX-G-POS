import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { hashOpaqueToken } from "@/server/identity/token";
import { writeAuditLog } from "@/server/identity/audit";
import { verifyUserPin, type VerifyPinResult } from "@/server/identity/approvalPin";
import { canSell } from "@/server/sales/saleService";

/**
 * Shared counter (owner decision 2026-10-15).
 *
 * In a small shop one computer stays signed in at the counter and several people sell on it. Each
 * person taps their name and types their own PIN; from then on bills are recorded under them
 * (`Sale.cashierUserId`) until the till locks or `OPERATOR_IDLE_MINUTES` pass without a sale. The
 * shift and its cash drawer belong to the counter, so Day Close counts one drawer and shows each
 * salesman's share. Staff who sign in on their own phone are unaffected: they sell as themselves.
 *
 * The chosen person lives on the server-side session row, never in a client-held value, so a
 * browser cannot name someone else as the seller.
 */

export const OPERATOR_IDLE_MINUTES = 15;

export interface TillStaff {
  id: string;
  name: string;
  hasPin: boolean;
}

/** Everyone who can sell in this store (owner included), with whether a PIN is set. Names only. */
export async function listTillStaff(params: { tenantId: string; storeId: string }): Promise<TillStaff[]> {
  const users = await db.user.findMany({
    where: {
      tenantId: params.tenantId,
      status: "ACTIVE",
      OR: [{ tenantRole: "OWNER" }, { memberships: { some: { storeId: params.storeId } } }],
    },
    select: {
      id: true,
      name: true,
      tenantRole: true,
      approvalPinHash: true,
      memberships: { where: { storeId: params.storeId }, select: { role: true } },
    },
    orderBy: { name: "asc" },
  });
  return users
    .filter((u) =>
      canSell({ tenantRole: u.tenantRole === "OWNER" ? "OWNER" : "STAFF", membershipRole: u.memberships[0]?.role ?? null }),
    )
    .map((u) => ({ id: u.id, name: u.name, hasPin: Boolean(u.approvalPinHash) }));
}

async function sessionRow(token: string | undefined) {
  if (!token) return null;
  return db.session.findUnique({
    where: { tokenHash: hashOpaqueToken(token) },
    select: { id: true, tenantId: true, tillOperatorUserId: true, tillOperatorUntil: true, revokedAt: true },
  });
}

export type SwitchResult =
  | { status: "ok"; operator: { id: string; name: string } }
  | Exclude<VerifyPinResult, { status: "ok" }>;

/** Hand the signed-in till to a team member who proves it with their own PIN. */
export async function switchTillOperator(params: {
  sessionToken: string | undefined;
  tenantId: string;
  storeId: string;
  userId: string;
  pin: string;
  now?: Date;
}): Promise<SwitchResult> {
  const now = params.now ?? new Date();
  const staff = await listTillStaff({ tenantId: params.tenantId, storeId: params.storeId });
  const person = staff.find((s) => s.id === params.userId);
  const verdict = await verifyUserPin({
    tenantId: params.tenantId,
    storeId: params.storeId,
    userId: params.userId,
    pin: params.pin,
    eligible: Boolean(person),
    now,
  });
  if (verdict.status !== "ok") return verdict;

  const session = await sessionRow(params.sessionToken);
  if (!person || !session || session.tenantId !== params.tenantId || session.revokedAt) return { status: "not_allowed" };
  await db.session.update({
    where: { id: session.id },
    data: { tillOperatorUserId: person.id, tillOperatorUntil: new Date(now.getTime() + OPERATOR_IDLE_MINUTES * 60_000) },
  });
  await writeAuditLog({
    tenantId: params.tenantId,
    userId: person.id,
    action: "till.operator_switched",
    correlationId: randomUUID(),
    metadata: { storeId: params.storeId },
  });
  return { status: "ok", operator: { id: person.id, name: person.name } };
}

/** Lock the till: bills go back to the signed-in user until someone types their PIN. */
export async function clearTillOperator(sessionToken: string | undefined): Promise<void> {
  const session = await sessionRow(sessionToken);
  if (!session) return;
  await db.session.update({ where: { id: session.id }, data: { tillOperatorUserId: null, tillOperatorUntil: null } });
}

async function liveOperator(params: { sessionToken: string | undefined; tenantId: string; storeId: string; now: Date }) {
  const session = await sessionRow(params.sessionToken);
  const op = session?.tillOperatorUserId;
  if (!session || !op || !session.tillOperatorUntil || session.tillOperatorUntil <= params.now) return null;
  if (session.tenantId !== params.tenantId || session.revokedAt) return null;
  const staff = await listTillStaff({ tenantId: params.tenantId, storeId: params.storeId });
  const person = staff.find((s) => s.id === op);
  return person ? { sessionId: session.id, person } : null;
}

/**
 * Who a bill on this signed-in session belongs to: the PIN-chosen operator while still current and
 * still allowed to sell here, else the signed-in user. A sale extends the operator's window.
 */
export async function resolveSeller(params: {
  sessionToken: string | undefined;
  tenantId: string;
  storeId: string;
  signedInUserId: string;
  now?: Date;
}): Promise<{ sellerUserId: string; viaOperator: boolean }> {
  const now = params.now ?? new Date();
  const live = await liveOperator({ ...params, now });
  if (!live) return { sellerUserId: params.signedInUserId, viaOperator: false };
  await db.session.update({
    where: { id: live.sessionId },
    data: { tillOperatorUntil: new Date(now.getTime() + OPERATOR_IDLE_MINUTES * 60_000) },
  });
  return { sellerUserId: live.person.id, viaOperator: live.person.id !== params.signedInUserId };
}

/** The current operator for the till screen, if any. */
export async function currentTillOperator(params: {
  sessionToken: string | undefined;
  tenantId: string;
  storeId: string;
  now?: Date;
}): Promise<{ id: string; name: string } | null> {
  const live = await liveOperator({ ...params, now: params.now ?? new Date() });
  return live ? { id: live.person.id, name: live.person.name } : null;
}
