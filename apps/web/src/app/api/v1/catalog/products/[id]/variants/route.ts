import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { createVariant } from "@/server/catalog/catalogService";
import { generateUniqueShortBarcode } from "@/server/catalog/barcodeGenerator";
import { GstTaxTreatment } from "@prisma/client";
import { gstClassificationError } from "@/server/catalog/gstTaxTreatment";

export const runtime = "nodejs";

const schema = z.object({
  sku: z.string().trim().max(100).nullable().optional(),
  barcode: z.string().trim().max(100).nullable().optional(),
  size: z.string().trim().max(50).nullable().optional(),
  colour: z.string().trim().max(50).nullable().optional(),
  costPriceMinor: z.number().int().min(0, "Cost price cannot be negative").nullable().optional(),
  priceMinor: z.number().int().min(0, "Price cannot be negative"),
  mrpMinor: z.number().int().min(0).nullable().optional(),
  taxRateBp: z.number().int().min(0).default(0),
  taxTreatment: z.nativeEnum(GstTaxTreatment).default(GstTaxTreatment.NON_GST),
  taxExemptionRef: z.string().trim().max(200).nullable().optional(),
  taxRateMode: z.enum(["FIXED", "APPAREL_SLAB"]).optional(),
  isActive: z.boolean().default(true),
}).superRefine((variant, ctx) => {
  const error = gstClassificationError({
    taxRateBp: variant.taxRateBp,
    taxTreatment: variant.taxTreatment,
    taxExemptionRef: variant.taxExemptionRef ?? null,
  });
  if (error) ctx.addIssue({ code: "custom", message: error, path: ["taxTreatment"] });
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

    // Auto-generate SKU if omitted by the user
    const generatedSku =
      parsed.data.sku && parsed.data.sku.trim().length > 0
        ? parsed.data.sku.trim()
        : `SKU-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substring(2, 5).toUpperCase()}`;

    // Auto-generate compact short barcode (Code-128 thermal friendly) if omitted
    const barcodeToUse =
      parsed.data.barcode && parsed.data.barcode.trim().length > 0
        ? parsed.data.barcode.trim()
        : await generateUniqueShortBarcode(resolved.context.tenantId);

    const result = await createVariant({
      actor: {
        tenantId: resolved.context.tenantId,
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
      },
      productId: id,
      sku: generatedSku,
      barcode: barcodeToUse,
      size: parsed.data.size ?? null,
      colour: parsed.data.colour ?? null,
      costPriceMinor: parsed.data.costPriceMinor ?? null,
      priceMinor: parsed.data.priceMinor,
      mrpMinor: parsed.data.mrpMinor ?? null,
      taxRateBp: parsed.data.taxRateBp,
      taxTreatment: parsed.data.taxTreatment,
      taxExemptionRef: parsed.data.taxExemptionRef ?? null,
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
      return apiError({ code: "not_found", message: "Product not found.", status: 404, correlationId });
    }
    if (result.status === "conflict") {
      return apiError({ code: "conflict", message: "SKU or barcode already exists.", status: 409, correlationId });
    }

    if (result.status === "ok") {
      return NextResponse.json({ status: "ok", variantId: result.variantId, correlationId }, { status: 201 });
    } else {
      return apiError({ code: "error", message: "Error", status: 400, correlationId });
    }
  } catch (err) {
    logError("catalog: create variant failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Temporarily unavailable.");
  }
}
