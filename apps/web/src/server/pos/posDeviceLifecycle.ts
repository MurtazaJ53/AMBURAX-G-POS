import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { generateOpaqueToken, hashOpaqueToken } from "@/server/identity/token";
import { env } from "@/lib/env";
import { writeAuditLog } from "@/server/identity/audit";
import { enqueueOutboxEvent } from "@/server/events/outbox";
import { Capability } from "@/server/capability/capabilities";
import { requireCapability } from "@/server/capability/capabilityService";
import { canConfigurePos } from "@/server/pos/posRoles";
import { generatePairingCode, hashPairingCode, formatPairingCode } from "@/server/pos/posDevice";

export interface PosDeviceLifecycleActor {
  tenantId: string;
  userId: string;
  tenantRole: "OWNER" | "STAFF";
  membershipRole: string | null;
  storeId: string;
}

export type DisablePosDeviceResult =
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "capability_disabled"; capability: Capability }
  | { status: "ok" };

export async function disablePosDevice(params: {
  actor: PosDeviceLifecycleActor;
  posDeviceId: string;
  correlationId: string;
}): Promise<DisablePosDeviceResult> {
  const { tenantId } = params.actor;

  const gate = await requireCapability(tenantId, Capability.RETAIL);
  if (gate.status !== "ok") {
    return { status: "capability_disabled", capability: gate.capability };
  }
  if (!canConfigurePos({ 
    tenantRole: params.actor.tenantRole,
    storeBelongsToTenant: true,
    membershipRole: params.actor.membershipRole
  })) {
    return { status: "forbidden" };
  }

  const device = await db.posDevice.findFirst({
    where: { id: params.posDeviceId, tenantId },
    select: { id: true, code: true, name: true, storeId: true, disabledAt: true, activeSessionId: true },
  });

  if (!device) return { status: "not_found" };
  if (device.storeId !== params.actor.storeId) return { status: "forbidden" };
  if (device.disabledAt) return { status: "ok" }; // Idempotent

  await db.$transaction(async (tx) => {
    // 1. Disable the device. We do NOT clear activeSessionId or close the session here.
    // The shift remains open historically until explicitly closed.
    const updated = await tx.posDevice.updateMany({
      where: { id: device.id, tenantId, disabledAt: null },
      data: { disabledAt: new Date() },
    });
    
    if (updated.count === 0) return; // Concurrent modification

    // 2. Outbox event
    await enqueueOutboxEvent(tx, {
      tenantId: tenantId,
      storeId: device.storeId,
      eventType: "PosDeviceDisabled",
      actorUserId: params.actor.userId,
      correlationId: params.correlationId,
      entityId: device.id,
      payload: {
        code: device.code,
        name: device.name,
        storeId: device.storeId,
        status: "DISABLED",
      },
      discriminator: params.correlationId,
    });
  });

  await writeAuditLog({
    tenantId: tenantId,
    userId: params.actor.userId,
    action: "PosDeviceDisabled",
    correlationId: params.correlationId,
    metadata: { posDeviceId: device.id, storeId: device.storeId },
  });

  return { status: "ok" };
}

export type RepairPosDeviceResult =
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "not_disabled" }
  | { status: "capability_disabled"; capability: Capability }
  | {
      status: "ok";
      pairingCode: string;
      pairingExpiresAt: Date;
    };

export async function repairPosDevice(params: {
  actor: PosDeviceLifecycleActor;
  posDeviceId: string;
  correlationId: string;
}): Promise<RepairPosDeviceResult> {
  const { tenantId } = params.actor;

  const gate = await requireCapability(tenantId, Capability.RETAIL);
  if (gate.status !== "ok") {
    return { status: "capability_disabled", capability: gate.capability };
  }
  if (!canConfigurePos({ 
    tenantRole: params.actor.tenantRole,
    storeBelongsToTenant: true,
    membershipRole: params.actor.membershipRole
  })) {
    return { status: "forbidden" };
  }

  const device = await db.posDevice.findFirst({
    where: { id: params.posDeviceId, tenantId },
    select: { id: true, code: true, name: true, storeId: true, disabledAt: true },
  });

  if (!device) return { status: "not_found" };
  if (device.storeId !== params.actor.storeId) return { status: "forbidden" };
  if (!device.disabledAt) return { status: "not_disabled" };

  const pairingCode = generatePairingCode();
  const pairingExpiresAt = new Date(Date.now() + env.POS_PAIRING_TTL_MINUTES * 60 * 1000);

  await db.$transaction(async (tx) => {
    const updated = await tx.posDevice.updateMany({
      where: { id: device.id, tenantId, disabledAt: { not: null } },
      data: {
        disabledAt: null,
        activatedAt: null,
        deviceSecretHash: null,
        pairingCodeHash: hashPairingCode(pairingCode),
        pairingExpiresAt,
      },
    });

    if (updated.count === 0) return;

    await enqueueOutboxEvent(tx, {
      tenantId: tenantId,
      storeId: device.storeId,
      eventType: "PosDeviceCreated", // Emits created to signal pending activation again
      actorUserId: params.actor.userId,
      correlationId: params.correlationId,
      entityId: device.id,
      payload: {
        code: device.code,
        name: device.name,
        storeId: device.storeId,
        status: "PENDING_ACTIVATION",
      },
      discriminator: "re-pair-" + params.correlationId,
    });
  });

  await writeAuditLog({
    tenantId: tenantId,
    userId: params.actor.userId,
    action: "PosDeviceRepaired",
    correlationId: params.correlationId,
    metadata: { posDeviceId: device.id, storeId: device.storeId },
  });

  return {
    status: "ok",
    pairingCode: formatPairingCode(pairingCode),
    pairingExpiresAt,
  };
}

export type PairHereResult =
  | { status: "ok"; device: { id: string; code: string; name: string } }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "capability_disabled"; capability: string }
  | { status: "disabled" }
  | { status: "already_activated" };

/**
 * Pair a terminal in person: an owner or store manager, signed in on the computer that will be the
 * terminal, makes it ACTIVE in one step. The pairing code exists to prove possession on a device
 * nobody is signed in to; a signed-in manager standing at the till already proves more than that.
 * Same guards as the code path: the role check, the store, an atomic claim that only a not-yet-active,
 * not-disabled terminal wins, the PosDeviceActivated event and an audit row. A disabled terminal stays
 * disabled (that was an owner's decision; re-enable it in Settings -> Terminals).
 */
export async function pairPosDeviceHere(params: {
  actor: PosDeviceLifecycleActor;
  posDeviceId: string;
  correlationId?: string;
}): Promise<PairHereResult> {
  const { tenantId } = params.actor;
  const correlationId = params.correlationId ?? randomUUID();
  const gate = await requireCapability(tenantId, Capability.RETAIL);
  if (gate.status !== "ok") return { status: "capability_disabled", capability: gate.capability };
  if (!canConfigurePos({ tenantRole: params.actor.tenantRole, storeBelongsToTenant: true, membershipRole: params.actor.membershipRole })) {
    return { status: "forbidden" };
  }
  const device = await db.posDevice.findFirst({
    where: { id: params.posDeviceId, tenantId },
    select: { id: true, code: true, name: true, storeId: true, activatedAt: true, disabledAt: true },
  });
  if (!device) return { status: "not_found" };
  if (device.storeId !== params.actor.storeId) return { status: "forbidden" };
  if (device.disabledAt) return { status: "disabled" };
  if (device.activatedAt) return { status: "already_activated" };

  const claimed = await db.$transaction(async (tx) => {
    const updated = await tx.posDevice.updateMany({
      where: { id: device.id, tenantId, activatedAt: null, disabledAt: null },
      data: {
        activatedAt: new Date(),
        lastSeenAt: new Date(),
        // A fresh secret, never shown: nothing in this version authenticates a terminal by it.
        deviceSecretHash: hashOpaqueToken(generateOpaqueToken()),
        pairingCodeHash: null,
        pairingExpiresAt: null,
      },
    });
    if (updated.count === 0) return false;
    await enqueueOutboxEvent(tx, {
      tenantId,
      storeId: device.storeId,
      eventType: "PosDeviceActivated",
      correlationId,
      actorUserId: params.actor.userId,
      entityId: device.id,
      payload: { code: device.code, name: device.name, storeId: device.storeId, status: "ACTIVE" },
      discriminator: correlationId,
    });
    return true;
  });
  if (!claimed) return { status: "already_activated" };
  await writeAuditLog({
    tenantId,
    userId: params.actor.userId,
    action: "PosDevicePairedInPerson",
    correlationId,
    metadata: { posDeviceId: device.id, code: device.code },
  });
  return { status: "ok", device: { id: device.id, code: device.code, name: device.name } };
}

