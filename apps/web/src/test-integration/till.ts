import { randomUUID } from "node:crypto";
import { db } from "./db";

/**
 * An open till shift with cash in the drawer, for tests that pay cash refunds or payouts (E7: every
 * cash refund names the till that pays it). Written directly, so it needs no pairing flow.
 */
export async function openTestTill(params: {
  tenantId: string;
  storeId: string;
  cashierUserId: string;
  floatMinor?: number;
  code?: string;
}): Promise<string> {
  const device = await db.posDevice.create({
    data: {
      tenantId: params.tenantId,
      storeId: params.storeId,
      name: `Test till ${params.code ?? "T9"}`,
      code: params.code ?? "T9",
      createdByUserId: params.cashierUserId,
      pairingCodeHash: `test-${randomUUID()}`,
      pairingExpiresAt: new Date(Date.now() + 100_000),
      activatedAt: new Date(),
    },
    select: { id: true },
  });
  const session = await db.posSession.create({
    data: {
      tenantId: params.tenantId,
      storeId: params.storeId,
      posDeviceId: device.id,
      cashierUserId: params.cashierUserId,
      openingFloatMinor: params.floatMinor ?? 10_000_000,
    },
    select: { id: true },
  });
  await db.posDevice.update({ where: { id: device.id }, data: { activeSessionId: session.id } });
  return session.id;
}
