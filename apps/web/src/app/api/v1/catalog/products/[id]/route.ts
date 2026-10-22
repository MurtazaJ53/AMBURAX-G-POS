import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { GstTaxTreatment, TaxRateMode } from "@prisma/client";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { updateProduct } from "@/server/catalog/catalogService";

export const runtime = "nodejs";

const variantUpdateSchema = z.object({
  id: z.string().optional(),
  sku: z.string().trim().nullable().optional(),
  barcode: z.string().trim().nullable().optional(),
  size: z.string().trim().nullable().optional(),
  colour: z.string().trim().nullable().optional(),
  costPriceMinor: z.number().min(0).nullable().optional(),
  priceMinor: z.number().min(0, "Selling price must be non-negative"),
  mrpMinor: z.number().min(0).nullable().optional(),
  taxRateBp: z.number().int().min(0).optional(),
  taxRateMode: z.nativeEnum(TaxRateMode).optional(),
  taxTreatment: z.nativeEnum(GstTaxTreatment).optional(),
  taxExemptionRef: z.string().nullable().optional(),
  openingQty: z.number().int().min(0).nullable().optional(),
  isFreeSample: z.boolean().optional(),
  isActive: z.boolean().default(true),
});

const schema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().max(100).nullable().optional(),
  brand: z.string().trim().max(100).nullable().optional(),
  imageUrl: z.string().trim().max(1000).nullable().optional().or(z.literal("")),
  hsnCode: z.string().trim().regex(/^\d{4,8}$/, "HSN code must be 4 to 8 digits").nullable().optional(),
  isActive: z.boolean().optional(),
  baseUomId: z.string().nullable().optional(),
  variants: z.array(variantUpdateSchema).optional(),
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

    const result = await updateProduct({
      actor: {
        tenantId: resolved.context.tenantId,
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
      },
      storeId: resolved.context.storeId,
      productId: id,
      name: parsed.data.name,
      category: parsed.data.category,
      brand: parsed.data.brand,
      imageUrl: parsed.data.imageUrl ? parsed.data.imageUrl : (parsed.data.imageUrl === "" || parsed.data.imageUrl === null ? null : undefined),
      hsnCode: parsed.data.hsnCode,
      isActive: parsed.data.isActive,
      baseUomId: parsed.data.baseUomId,
      variants: parsed.data.variants,
      correlationId,
    });

    if (result.status === "forbidden") {
      return forbidden(correlationId, "You do not have permission to manage the catalogue.");
    }
    if (result.status === "not_found") {
      return apiError({ code: "not_found", message: "Product or UOM not found.", status: 404, correlationId });
    }
    if (result.status === "duplicate_product_name") {
      return apiError({
        code: "duplicate_product_name",
        message: `A product with name "${parsed.data.name || "this name"}" and brand "${parsed.data.brand || "None"}" already exists in your shop.`,
        status: 409,
        correlationId,
      });
    }
    if (result.status === "duplicate_sku") {
      return apiError({ code: "duplicate_sku", message: `SKU "${result.sku}" already belongs to another product variant.`, status: 409, correlationId });
    }
    if (result.status === "duplicate_barcode") {
      return apiError({ code: "duplicate_barcode", message: `Barcode "${result.barcode}" already belongs to another variant.`, status: 409, correlationId });
    }
    if (result.status === "conflict") {
      return apiError({ code: "conflict", message: "Conflict.", status: 409, correlationId });
    }

    return NextResponse.json({ status: "ok", correlationId }, { status: 200 });
  } catch (err) {
    logError("catalog: update product failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Temporarily unavailable.");
  }
}
