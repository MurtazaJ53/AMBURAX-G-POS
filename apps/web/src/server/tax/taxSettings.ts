import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { writeAuditLogTx } from "@/server/identity/audit";
import type { ApparelSlab } from "@/server/sales/saleTotals";

/**
 * The tenant's garment GST slab.
 *
 * Owner decision 2026-10-13: 5% when the value of one piece is at or below Rs 2,500, 18% above,
 * stored as data so a change in the law or in the CA's reading is a settings edit. Every tenant
 * starts on those values; only the tenant OWNER may change them.
 */

export const DEFAULT_APPAREL_SLAB: ApparelSlab = { thresholdMinor: 250_000, lowRateBp: 500, highRateBp: 1_800 };

export async function getApparelSlab(tenantId: string): Promise<ApparelSlab> {
  const row = await db.tenantTaxSetting.findUnique({
    where: { tenantId },
    select: { apparelThresholdMinor: true, apparelLowRateBp: true, apparelHighRateBp: true },
  });
  if (!row) return DEFAULT_APPAREL_SLAB;
  return {
    thresholdMinor: row.apparelThresholdMinor,
    lowRateBp: row.apparelLowRateBp,
    highRateBp: row.apparelHighRateBp,
  };
}

export function validateApparelSlab(slab: ApparelSlab): string | null {
  const intIn = (n: number, lo: number, hi: number) => Number.isSafeInteger(n) && n >= lo && n <= hi;
  if (!intIn(slab.thresholdMinor, 1, 1_000_000_000)) return "Enter a valid price limit.";
  if (!intIn(slab.lowRateBp, 1, 10_000)) return "Enter a valid lower GST rate.";
  if (!intIn(slab.highRateBp, 1, 10_000)) return "Enter a valid higher GST rate.";
  if (slab.highRateBp < slab.lowRateBp) return "The higher rate cannot be below the lower rate.";
  return null;
}

export async function updateApparelSlab(params: {
  tenantId: string;
  actorUserId: string;
  tenantRole: "OWNER" | "STAFF";
  slab: ApparelSlab;
}): Promise<{ status: "ok" } | { status: "forbidden" } | { status: "validation_error"; reason: string }> {
  if (params.tenantRole !== "OWNER") return { status: "forbidden" };
  const invalid = validateApparelSlab(params.slab);
  if (invalid) return { status: "validation_error", reason: invalid };

  const before = await getApparelSlab(params.tenantId);
  await db.$transaction(async (tx) => {
    const data = {
      apparelThresholdMinor: params.slab.thresholdMinor,
      apparelLowRateBp: params.slab.lowRateBp,
      apparelHighRateBp: params.slab.highRateBp,
      updatedByUserId: params.actorUserId,
    };
    await tx.tenantTaxSetting.upsert({
      where: { tenantId: params.tenantId },
      create: { tenantId: params.tenantId, ...data },
      update: data,
    });
    await writeAuditLogTx(tx, {
      tenantId: params.tenantId,
      userId: params.actorUserId,
      action: "tax.apparel_slab_updated",
      correlationId: randomUUID(),
      metadata: { before: { ...before }, after: { ...params.slab } },
    });
  });
  return { status: "ok" };
}
