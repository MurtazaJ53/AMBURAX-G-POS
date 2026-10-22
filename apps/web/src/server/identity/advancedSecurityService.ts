import { db } from "@/server/db";
import { writeAuditLog } from "@/server/identity/audit";

export interface AdvancedSecuritySettings {
  stores: {
    id: string;
    name: string;
    code: string;
    heldBillHours: number;
    lateGraceMinutes: number;
    halfDayPercent: number;
  }[];
  devices: {
    id: string;
    name: string;
    code: string;
    storeName: string;
    createdAt: Date;
    isPaired: boolean;
  }[];
}

export async function getAdvancedSecuritySettings(tenantId: string): Promise<AdvancedSecuritySettings> {
  const [stores, devices] = await Promise.all([
    db.store.findMany({
      where: { tenantId },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        code: true,
        heldBillHours: true,
        lateGraceMinutes: true,
        halfDayPercent: true,
      },
    }),
    db.posDevice.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        code: true,
        store: { select: { name: true } },
        createdAt: true,
        pairingCodeHash: true,
      },
    }),
  ]);

  return {
    stores,
    devices: devices.map((d) => ({
      id: d.id,
      name: d.name,
      code: d.code,
      storeName: d.store.name,
      createdAt: d.createdAt,
      // If pairingCodeHash is null or expired, the device has completed pairing
      isPaired: !d.pairingCodeHash,
    })),
  };
}

export async function updateStoreSecurityPolicy(params: {
  tenantId: string;
  actorUserId: string;
  storeId: string;
  heldBillHours: number;
  lateGraceMinutes: number;
}) {
  const store = await db.store.findFirst({
    where: { id: params.storeId, tenantId: params.tenantId },
  });
  if (!store) throw new Error("Store not found or unauthorized");

  const heldBillHours = Math.min(24, Math.max(1, params.heldBillHours));
  const lateGraceMinutes = Math.min(60, Math.max(0, params.lateGraceMinutes));

  await db.store.update({
    where: { id: params.storeId },
    data: {
      heldBillHours,
      lateGraceMinutes,
    },
  });

  await writeAuditLog({
    tenantId: params.tenantId,
    userId: params.actorUserId,
    action: "store_security_policy_updated",
    correlationId: `policy-${Date.now()}`,
    metadata: {
      storeId: params.storeId,
      heldBillHours,
      lateGraceMinutes,
    },
  });

  return { status: "ok" };
}

export async function revokeDevicePairing(params: {
  tenantId: string;
  actorUserId: string;
  deviceId: string;
}) {
  const device = await db.posDevice.findFirst({
    where: { id: params.deviceId, tenantId: params.tenantId },
  });
  if (!device) throw new Error("POS Device not found or unauthorized");

  // Re-generate pairing code requirement to lock out previous device session
  await db.posDevice.update({
    where: { id: params.deviceId },
    data: {
      pairingCodeHash: "REVOKED_REQUIRES_NEW_PAIRING",
      pairingExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  await writeAuditLog({
    tenantId: params.tenantId,
    userId: params.actorUserId,
    action: "device_pairing_revoked",
    correlationId: `device-${Date.now()}`,
    metadata: { deviceId: params.deviceId, code: device.code },
  });

  return { status: "ok" };
}
