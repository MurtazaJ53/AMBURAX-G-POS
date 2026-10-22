import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { updateVariant } from "@/server/catalog/catalogService";
import { GstTaxTreatment } from "@prisma/client";

export const runtime = "nodejs";

const schema = z.object({
  sku: z.string().trim().min(1).max(100).optional(),
  barcode: z.string().trim().max(100).nullable().optional(),
  size: z.string().trim().max(50).nullable().optional(),
  colour: z.string().trim().max(50).nullable().optional(),
  costPriceMinor: z.number().int().min(0, "Cost price cannot be negative").nullable().optional(),
  priceMinor: z.number().int().min(0).optional(),
  mrpMinor: z.number().int().min(0).nullable().optional(),
  taxRateBp: z.number().int().min(0).optional(),
  taxTreatment: z.nativeEnum(GstTaxTreatment).optional(),
  taxExemptionRef: z.string().trim().max(200).nullable().optional(),
  taxRateMode: z.enum(["FIXED", "APPAREL_SLAB"]).optional(),
  isActive: z.boolean().optional(),
}).superRefine((variant, ctx) => {
  if (variant.taxRateBp !== undefined && variant.taxTreatment === undefined) {
    ctx.addIssue({ code: "custom", message: "Changing the tax rate requires an explicit tax treatment.", path: ["taxTreatment"] });
  }
  if (variant.taxTreatment === GstTaxTreatment.EXEMPT && !variant.taxExemptionRef?.trim()) {
    ctx.addIssue({ code: "custom", message: "Exempt items require a statutory reference.", path: ["taxExemptionRef"] });
  }
});

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError({ code: "invalid_request", message: "Malformed request body.", status: 400, correlationId });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return apiError({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid data.", status: 400, correlationId });
  }

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return apiError({ code: "no_store", message: "No store", status: 400, correlationId });

    const result = await updateVariant({
      actor: {
        tenantId: resolved.context.tenantId,
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
      },
      variantId: id,
      sku: parsed.data.sku,
      barcode: parsed.data.barcode,
      size: parsed.data.size,
      colour: parsed.data.colour,
      costPriceMinor: parsed.data.costPriceMinor,
      priceMinor: parsed.data.priceMinor,
      mrpMinor: parsed.data.mrpMinor,
      taxRateBp: parsed.data.taxRateBp,
      taxTreatment: parsed.data.taxTreatment,
      taxExemptionRef: parsed.data.taxExemptionRef,
      taxRateMode: parsed.data.taxRateMode,
      isActive: parsed.data.isActive,
      correlationId,
    });

    if (result.status === "invalid_tax_classification") {
      return apiError({ code: "validation_error", message: "Check the tax treatment, rate, and statutory reference.", status: 400, correlationId });
    }

    if (result.status === "duplicate_barcode") {
      return apiError({ code: "conflict", message: `Barcode "${result.barcode}" is already assigned to another variant.`, status: 409, correlationId });
    }

    if (result.status === "duplicate_sku") {
      return apiError({ code: "conflict", message: `SKU "${result.sku}" is already in use.`, status: 409, correlationId });
    }

    if (result.status === "forbidden") {
      return forbidden(correlationId, "You do not have permission to manage the catalogue.");
    }
    if (result.status === "not_found") {
      return apiError({ code: "not_found", message: "Variant not found.", status: 404, correlationId });
    }
    if (result.status === "conflict") {
      return apiError({ code: "conflict", message: "SKU or barcode already exists.", status: 409, correlationId });
    }

    return NextResponse.json({ status: "ok", correlationId }, { status: 200 });
  } catch (err) {
    logError("catalog: update variant failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Temporarily unavailable.");
  }
}
