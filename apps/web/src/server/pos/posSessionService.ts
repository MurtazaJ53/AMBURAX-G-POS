import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAuditLog } from "@/server/identity/audit";
import { canSell } from "@/server/sales/sellingRoles";
import { Capability } from "@/server/capability/capabilities";
import { requireCapability } from "@/server/capability/capabilityService";
import { derivePosDeviceStatus } from "@/server/pos/posDevice";

/**
 * Shifts: a cashier opening a till, working it, and handing it over.
 *
 * ## Why this is its own row
 *
 * A POS device is hardware. A User is a person. A Store is a place. A Sale is one transaction.
 * None of them answers "which till rang this up, whose shift was it, and what belongs to the
 * handover" — and a retail backend that cannot answer those cannot reconcile a day.
 *
 * ## This is not cash management
 *
 * There is no opening float, no counted drawer, no variance and no reconciliation here. Closing
 * a session means "this shift is over", **not** "the till was counted and balanced". None of the
 * cash side has been designed, and a half-modelled drawer is worse than none: it invites people
 * to trust a number nobody computed. When cash management arrives it attaches to this row.
 *
 * ## One shift per till, enforced by shape
 *
 * `PosDevice.activeSessionId` is a pointer, so "two shifts open on one till" is not a state the
 * database can represent. Opening claims the pointer with a conditional update, so two cashiers
 * racing for the same till produce one winner and one plain refusal — not two half-open shifts.
 *
 * ## Capability
 *
 * Opening a shift is a RETAIL operation and is gated. The gate sits here, at the domain
 * boundary, so a direct HTTP call is refused exactly as a click would be.
 */

export interface PosSessionActor {
  tenantId: string;
  userId: string;
  tenantRole: "OWNER" | "STAFF";
  membershipRole: string | null;
}

export type PosSessionFailure =
  | { status: "forbidden" }
  | { status: "not_found"; what: "device" | "session" }
  | { status: "validation_error"; field: string; reason: string }
  /** The till already has a shift open, or the shift is already closed. */
  | { status: "conflict"; reason: string }
  /** The device is not paired/activated, or has been disabled. */
  | { status: "device_unavailable"; reason: string }
  | { status: "capability_disabled"; capability: Capability };

export interface PosSessionView {
  id: string;
  storeId: string;
  posDeviceId: string;
  cashierUserId: string;
  openedAt: Date;
  closedAt: Date | null;
  closingNote: string | null;
  /** Derived from `closedAt`; there is no status column to disagree with it. */
  isOpen: boolean;
}

const SESSION_SELECT = {
  id: true,
  storeId: true,
  posDeviceId: true,
  cashierUserId: true,
  openedAt: true,
  closedAt: true,
  closingNote: true,
} satisfies Prisma.PosSessionSelect;

function toView(row: {
  id: string;
  storeId: string;
  posDeviceId: string;
  cashierUserId: string;
  openedAt: Date;
  closedAt: Date | null;
  closingNote: string | null;
}): PosSessionView {
  return { ...row, isOpen: row.closedAt === null };
}

/** Internal signal that the device pointer was claimed by someone else mid-transaction. */
class PosSessionRace extends Error {}

export type OpenPosSessionResult =
  | { status: "ok"; session: PosSessionView; resumed: boolean }
  | PosSessionFailure;

/**
 * Open a shift on a till, or resume the caller's own shift if one is already open on it.
 *
 * Resuming rather than refusing matters: a cashier whose browser reloaded, or whose device
 * reconnected, is not starting a second shift and must not be told the till is busy by their own
 * earlier self. A shift belonging to *someone else* is a conflict, because handing over a till
 * without closing it is exactly the thing a shift record exists to prevent.
 */
export async function openPosSession(params: {
  actor: PosSessionActor;
  posDeviceId: string;
  correlationId: string;
}): Promise<OpenPosSessionResult> {
  const { tenantId } = params.actor;

  const gate = await requireCapability(tenantId, Capability.RETAIL);
  if (gate.status !== "ok") {
    return { status: "capability_disabled", capability: gate.capability };
  }

  // Tenant-scoped, so another tenant's till is indistinguishable from one that does not exist.
  const device = await db.posDevice.findFirst({
    where: { id: params.posDeviceId, tenantId },
    select: {
      id: true,
      storeId: true,
      activeSessionId: true,
      activatedAt: true,
      disabledAt: true,
      pairingExpiresAt: true,
    },
  });
  if (!device) return { status: "not_found", what: "device" };

  const deviceStatus = derivePosDeviceStatus(device);
  if (deviceStatus !== "ACTIVE") {
    return {
      status: "device_unavailable",
      reason: `This terminal is ${deviceStatus.toLowerCase().replace(/_/g, " ")}.`,
    };
  }

  // Selling authority, at the device's own store. A cashier with no membership there may not
  // open a till there, whatever they may do elsewhere.
  const membership = await db.storeMembership.findUnique({
    where: { userId_storeId: { userId: params.actor.userId, storeId: device.storeId } },
    select: { role: true },
  });
  const authorised = canSell({
    tenantRole: params.actor.tenantRole,
    membershipRole: membership?.role ?? null,
  });
  if (!authorised) return { status: "forbidden" };

  if (device.activeSessionId) {
    const existing = await db.posSession.findFirst({
      where: { id: device.activeSessionId, tenantId },
      select: SESSION_SELECT,
    });
    if (existing && existing.cashierUserId === params.actor.userId) {
      return { status: "ok", session: toView(existing), resumed: true };
    }
    return {
      status: "conflict",
      reason: "Another cashier already has a shift open on this terminal.",
    };
  }

  try {
    const session = await db.$transaction(async (tx) => {
      const created = await tx.posSession.create({
        data: {
          tenantId,
          storeId: device.storeId,
          posDeviceId: device.id,
          cashierUserId: params.actor.userId,
        },
        select: SESSION_SELECT,
      });

      // Conditional on the pointer still being free. Two cashiers racing for one till both reach
      // here; the loser matches zero rows and is refused rather than quietly opening a second
      // shift nobody will reconcile.
      const claimed = await tx.posDevice.updateMany({
        where: { id: device.id, tenantId, activeSessionId: null },
        data: { activeSessionId: created.id, lastSeenAt: new Date() },
      });
      if (claimed.count === 0) throw new PosSessionRace();

      return created;
    });

    await writeAuditLog({
      tenantId,
      userId: params.actor.userId,
      action: "PosSessionOpened",
      correlationId: params.correlationId,
      metadata: { sessionId: session.id, posDeviceId: device.id, storeId: device.storeId },
    });

    return { status: "ok", session: toView(session), resumed: false };
  } catch (err) {
    if (err instanceof PosSessionRace) {
      return {
        status: "conflict",
        reason: "Another cashier already has a shift open on this terminal.",
      };
    }
    throw err;
  }
}

export type ClosePosSessionResult = { status: "ok"; session: PosSessionView } | PosSessionFailure;

/**
 * Close a shift and free the till.
 *
 * The session row is updated, never deleted — a shift that happened is a fact, and the sales that
 * point at it must keep pointing somewhere. Only the device's pointer moves.
 *
 * Closing is deliberately not a reconciliation: no drawer count is taken and none is demanded.
 * `closingNote` is free text and explicitly not a money figure.
 */
export async function closePosSession(params: {
  actor: PosSessionActor;
  sessionId: string;
  closingNote?: string;
  correlationId: string;
}): Promise<ClosePosSessionResult> {
  const { tenantId } = params.actor;

  const session = await db.posSession.findFirst({
    where: { id: params.sessionId, tenantId },
    select: SESSION_SELECT,
  });
  if (!session) return { status: "not_found", what: "session" };

  if (session.closedAt) {
    return { status: "conflict", reason: "This shift is already closed." };
  }

  // The cashier who opened it, or a tenant owner closing on their behalf — a shift left open by
  // someone who has gone home must be closable by the person responsible for the store.
  const isOwnShift = session.cashierUserId === params.actor.userId;
  if (!isOwnShift && params.actor.tenantRole !== "OWNER") {
    return { status: "forbidden" };
  }

  const note = params.closingNote?.trim().replace(/\s+/g, " ") ?? null;
  if (note !== null && note.length > 500) {
    return { status: "validation_error", field: "closingNote", reason: "That note is too long." };
  }

  const closed = await db.$transaction(async (tx) => {
    const updated = await tx.posSession.updateMany({
      where: { id: session.id, tenantId, closedAt: null },
      data: { closedAt: new Date(), closingNote: note },
    });
    if (updated.count === 0) return null;

    // Free the till. Scoped to this session id, so a device since claimed by a different shift
    // is not cleared by a late close.
    await tx.posDevice.updateMany({
      where: { id: session.posDeviceId, tenantId, activeSessionId: session.id },
      data: { activeSessionId: null },
    });

    return tx.posSession.findUniqueOrThrow({ where: { id: session.id }, select: SESSION_SELECT });
  });

  if (!closed) return { status: "conflict", reason: "This shift is already closed." };

  await writeAuditLog({
    tenantId,
    userId: params.actor.userId,
    action: "PosSessionClosed",
    correlationId: params.correlationId,
    metadata: { sessionId: session.id, posDeviceId: session.posDeviceId, onBehalf: !isOwnShift },
  });

  return { status: "ok", session: toView(closed) };
}

export type ResolveSessionResult =
  | { status: "ok"; session: PosSessionView }
  | { status: "not_found"; what: "session" }
  | { status: "conflict"; reason: string };

/**
 * The shift a sale is about to be attributed to.
 *
 * Called by `createSale` when a caller supplies a session id. Every check here is one a client
 * must not be trusted to have made: that the shift is this tenant's, that it is still open, that
 * it is the caller's own, and that it belongs to the store being sold from.
 */
export async function resolveSessionForSale(params: {
  tenantId: string;
  sessionId: string;
  storeId: string;
  cashierUserId: string;
}): Promise<ResolveSessionResult> {
  const session = await db.posSession.findFirst({
    where: { id: params.sessionId, tenantId: params.tenantId },
    select: SESSION_SELECT,
  });
  if (!session) return { status: "not_found", what: "session" };

  if (session.closedAt) {
    return { status: "conflict", reason: "That shift has already been closed." };
  }
  if (session.storeId !== params.storeId) {
    return { status: "conflict", reason: "That shift belongs to a different store." };
  }
  if (session.cashierUserId !== params.cashierUserId) {
    return { status: "conflict", reason: "That shift belongs to a different cashier." };
  }

  return { status: "ok", session: toView(session) };
}

/** The shift currently open on a till, if any. Tenant-scoped. */
export async function currentSessionForDevice(params: {
  tenantId: string;
  posDeviceId: string;
}): Promise<PosSessionView | null> {
  const device = await db.posDevice.findFirst({
    where: { id: params.posDeviceId, tenantId: params.tenantId },
    select: { activeSessionId: true },
  });
  if (!device?.activeSessionId) return null;

  const session = await db.posSession.findFirst({
    where: { id: device.activeSessionId, tenantId: params.tenantId },
    select: SESSION_SELECT,
  });
  return session ? toView(session) : null;
}
