import { db } from "@/server/db";
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
