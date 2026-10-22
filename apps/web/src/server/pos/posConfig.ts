import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { writeAuditLog } from "@/server/identity/audit";

/**
 * POS configuration (screen 74), per store: how long a held bill lasts, and the attendance rules
 * the owner set in E5 (late after a grace, half day under a share of the shift). Owner only,
 * audited with before and after. Receipt layout (75) waits on the CA's tax-invoice field list.
 */

type Actor = { tenantId: string; userId: string; tenantRole: "OWNER" | "STAFF" };
export type PosConfig = { heldBillHours: number; lateGraceMinutes: number; halfDayPercent: number };

export const POS_CONFIG_LIMITS = {
  heldBillHours: [1, 24],
  lateGraceMinutes: [0, 120],
  halfDayPercent: [10, 90],
} as const satisfies Record<keyof PosConfig, readonly [number, number]>;

export async function getPosConfig(tenantId: string, storeId: string): Promise<PosConfig | null> {
  return db.store.findFirst({
    where: { id: storeId, tenantId },
    select: { heldBillHours: true, lateGraceMinutes: true, halfDayPercent: true },
  });
}

export async function savePosConfig(input: { actor: Actor; storeId: string; config: PosConfig }) {
  if (input.actor.tenantRole !== "OWNER") return { status: "forbidden" as const };
  for (const [k, [lo, hi]] of Object.entries(POS_CONFIG_LIMITS) as [keyof PosConfig, readonly [number, number]][]) {
    const v = input.config[k];
    if (!Number.isInteger(v) || v < lo || v > hi) {
      return { status: "validation_error" as const, reason: `${k} must be a whole number from ${lo} to ${hi}.` };
    }
  }
  const before = await getPosConfig(input.actor.tenantId, input.storeId);
  if (!before) return { status: "not_found" as const };
  await db.store.update({ where: { id: input.storeId }, data: input.config });
  await writeAuditLog({
    tenantId: input.actor.tenantId,
    userId: input.actor.userId,
    action: "PosConfigSaved",
    correlationId: randomUUID(),
    metadata: { storeId: input.storeId, before, after: input.config },
  });
  return { status: "ok" as const };
}
