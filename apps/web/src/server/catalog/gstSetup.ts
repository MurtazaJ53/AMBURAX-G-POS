import { randomUUID } from "node:crypto";
import { GSTIN_TAKEN_MESSAGE, isGstinTakenByAnotherTenant } from "@/server/tenant/gstinUniqueness";
import { GstTaxTreatment, type TaxRateMode } from "@prisma/client";
import { db } from "@/server/db";
import { writeAuditLog } from "@/server/identity/audit";
import { enqueueOutboxEvent } from "@/server/events/outbox";
import { TENANT_GST_REGISTERED_EVENT } from "@/server/erp/companyGstAdapter";
import { gstClassificationError } from "@/server/catalog/gstTaxTreatment";
import { withRateMode } from "@/server/catalog/catalogService";
import { storesOutsideGstin } from "@/lib/gstStates";

/**
 * GST setup (owner decisions 2026-10-16).
 *
 * - B3: a GST-registered business may sell TAXABLE products alongside EXEMPT, NIL_RATED,
 *   ZERO_RATED and NON_GST ones; only TAXABLE lines carry GST.
 * - A business that registers later turns GST on here with its GSTIN. Its products that were
 *   "no GST" (NON_GST) become UNSPECIFIED — option A: nothing is assumed taxable or exempt, and
 *   each must be given a GST type (one by one or in bulk) before it sells again.
 *
 * Statutory eligibility of a class is the owner's/CA's decision; this module only checks shape.
 */

const GSTIN_PATTERN = /^(\d{2})[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Why a GSTIN is not well formed (format, state code, check digit), or null. */
export function gstinProblem(raw: string): string | null {
  const gstin = raw.trim().toUpperCase();
  const m = GSTIN_PATTERN.exec(gstin);
  if (!m) return "A GSTIN is 15 characters, like 24ABCDE1234F1Z5.";
  const state = Number(m[1]);
  if (!((state >= 1 && state <= 38) || state === 97)) return "The first two digits must be a valid state code.";
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = GSTIN_CHARS.indexOf(gstin[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  const check = GSTIN_CHARS[(36 - (sum % 36)) % 36];
  if (check !== gstin[14]) return "That GSTIN's last character doesn't match — check it for a typo.";
  return null;
}

export const GST_SCHEMES = ["REGULAR", "COMPOSITION"] as const;
export type GstScheme = (typeof GST_SCHEMES)[number];

export const COMPOSITION_NOT_SUPPORTED =
  "Composition scheme isn't supported yet: composition dealers must issue a Bill of Supply and pay tax differently. Contact support.";

/** Why this GST scheme can't be used, or null. Only the regular scheme is supported. */
export function gstSchemeProblem(scheme: GstScheme | undefined): string | null {
  return scheme === "COMPOSITION" ? COMPOSITION_NOT_SUPPORTED : null;
}

type Owner = { tenantId: string; userId: string; tenantRole: "OWNER" | "STAFF" };

export type TurnOnGstResult =
  | { status: "ok"; needsReview: number }
  | { status: "forbidden" }
  | { status: "already_registered" }
  | { status: "invalid"; reason: string };

/** Register the business for GST from today. Owner only; once. */
export async function turnOnGst(input: { actor: Owner; gstin: string; scheme?: GstScheme }): Promise<TurnOnGstResult> {
  if (input.actor.tenantRole !== "OWNER") return { status: "forbidden" };
  const problem = gstSchemeProblem(input.scheme) ?? gstinProblem(input.gstin);
  if (problem) return { status: "invalid", reason: problem };
  const gstin = input.gstin.trim().toUpperCase();
  const correlationId = randomUUID();

  const result = await db.$transaction(async (tx) => {
    const tenant = await tx.tenant.findUnique({ where: { id: input.actor.tenantId }, select: { taxId: true } });
    if (tenant?.taxId?.trim()) return { status: "already_registered" as const };
    if (await isGstinTakenByAnotherTenant(gstin, input.actor.tenantId, tx)) {
      return { status: "invalid" as const, reason: GSTIN_TAKEN_MESSAGE };
    }
    // One GSTIN is one state: every existing store must already be in it.
    const stores = await tx.store.findMany({ where: { tenantId: input.actor.tenantId }, select: { name: true, state: true }, orderBy: { name: "asc" } });
    const outside = storesOutsideGstin(gstin, stores);
    if (outside) return { status: "invalid" as const, reason: outside };
    await tx.tenant.update({ where: { id: input.actor.tenantId }, data: { taxId: gstin } });
    // Option A: "no GST" products must be given a GST type before they sell again.
    const moved = await tx.productVariant.updateMany({
      where: { tenantId: input.actor.tenantId, taxTreatment: GstTaxTreatment.NON_GST },
      data: { taxTreatment: GstTaxTreatment.UNSPECIFIED, taxRateBp: 0, taxRateMode: "FIXED", taxExemptionRef: null },
    });
    // The ERPNext Company gets the same GSTIN.
    await enqueueOutboxEvent(tx, {
      tenantId: input.actor.tenantId,
      eventType: TENANT_GST_REGISTERED_EVENT,
      actorUserId: input.actor.userId,
      correlationId,
      entityId: input.actor.tenantId,
      payload: { tenantId: input.actor.tenantId },
    });
    return { status: "ok" as const, needsReview: moved.count };
  });
  if (result.status === "ok") {
    await writeAuditLog({
      tenantId: input.actor.tenantId,
      userId: input.actor.userId,
      action: "tenant.gst_registered",
      correlationId,
      metadata: { gstinLast4: gstin.slice(-4), productsNeedingGstType: result.needsReview },
    });
  }
  return result;
}

export const BULK_TREATMENTS = ["TAXABLE", "EXEMPT", "NIL_RATED", "ZERO_RATED", "NON_GST"] as const;
export type BulkTreatment = (typeof BULK_TREATMENTS)[number];

export type BulkGstResult =
  | { status: "ok"; updated: number }
  | { status: "forbidden" }
  | { status: "invalid"; reason: string };

/**
 * Give many variants one GST type. TAXABLE takes either the apparel slab or a fixed rate; EXEMPT
 * needs the statutory reference. Each variant re-syncs to ERPNext. Owner or store manager.
 */
export async function bulkSetGst(input: {
  actor: Owner & { membershipRole: string | null };
  variantIds: string[];
  treatment: BulkTreatment;
  rateMode?: TaxRateMode;
  rateBp?: number;
  exemptionRef?: string | null;
}): Promise<BulkGstResult> {
  const { actor } = input;
  if (actor.tenantRole !== "OWNER" && actor.membershipRole !== "STORE_MANAGER") return { status: "forbidden" };
  const ids = [...new Set(input.variantIds)].slice(0, 500);
  if (ids.length === 0) return { status: "invalid", reason: "Choose at least one product." };
  const treatment = GstTaxTreatment[input.treatment];
  const mode: TaxRateMode = treatment === GstTaxTreatment.TAXABLE && input.rateMode === "APPAREL_SLAB" ? "APPAREL_SLAB" : "FIXED";
  const exemptionRef = treatment === GstTaxTreatment.EXEMPT ? input.exemptionRef?.trim() || null : null;
  const fixedRate = treatment === GstTaxTreatment.TAXABLE && mode === "FIXED" ? input.rateBp ?? 0 : 0;

  // Check the shape once; the slab picks its own positive rate per item from its price.
  const probe = mode === "APPAREL_SLAB" ? 1 : fixedRate;
  const shape = gstClassificationError({ taxTreatment: treatment, taxRateBp: probe, taxExemptionRef: exemptionRef });
  if (shape) return { status: "invalid", reason: shape };

  const variants = await db.productVariant.findMany({
    where: { tenantId: actor.tenantId, id: { in: ids } },
    select: { id: true, priceMinor: true },
  });
  const resolved = await Promise.all(
    variants.map(async (v) => ({
      id: v.id,
      ...(await withRateMode(actor.tenantId, { taxTreatment: treatment, taxRateBp: fixedRate, taxExemptionRef: exemptionRef }, mode, v.priceMinor)),
    })),
  );
  const correlationId = randomUUID();
  await db.$transaction(async (tx) => {
    for (const r of resolved) {
      await tx.productVariant.update({
        where: { id: r.id, tenantId: actor.tenantId },
        data: { taxTreatment: r.taxTreatment, taxRateBp: r.taxRateBp, taxRateMode: r.taxRateMode, taxExemptionRef: r.taxExemptionRef },
      });
      await enqueueOutboxEvent(tx, {
        tenantId: actor.tenantId,
        eventType: "ProductVariantUpdated",
        actorUserId: actor.userId,
        correlationId,
        entityId: r.id,
        payload: { variantId: r.id },
        discriminator: `gst-${correlationId}`,
      });
    }
  });
  await writeAuditLog({
    tenantId: actor.tenantId,
    userId: actor.userId,
    action: "catalog.gst_bulk_set",
    correlationId,
    metadata: { count: resolved.length, treatment: input.treatment, rateMode: mode, rateBp: fixedRate },
  });
  return { status: "ok", updated: resolved.length };
}

/** Variants still needing a GST type, for the review screen. */
export async function listNeedingGst(params: { tenantId: string; q?: string; take?: number }) {
  const q = params.q?.trim();
  return db.productVariant.findMany({
    where: {
      tenantId: params.tenantId,
      taxTreatment: GstTaxTreatment.UNSPECIFIED,
      ...(q
        ? { OR: [{ sku: { contains: q, mode: "insensitive" as const } }, { product: { name: { contains: q, mode: "insensitive" as const } } }] }
        : {}),
    },
    orderBy: [{ product: { name: "asc" } }, { sku: "asc" }],
    take: params.take ?? 200,
    select: { id: true, sku: true, size: true, colour: true, priceMinor: true, product: { select: { name: true } } },
  });
}

export async function countNeedingGst(tenantId: string) {
  return db.productVariant.count({ where: { tenantId, taxTreatment: GstTaxTreatment.UNSPECIFIED } });
}
