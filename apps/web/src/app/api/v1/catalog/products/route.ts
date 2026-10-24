import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { createProduct, createVariant } from "@/server/catalog/catalogService";
import { GstTaxTreatment } from "@prisma/client";
import { gstClassificationError } from "@/server/catalog/gstTaxTreatment";
import { db } from "@/server/db";
import { normalizeProductKey, normalizeBrandValue } from "@/server/catalog/productNormalization";

export const runtime = "nodejs";

const variantItemSchema = z.object({
  sku: z.string().trim().max(100).nullable().optional(),
  barcode: z.string().trim().max(100).nullable().optional(),
  size: z.string().trim().max(100).nullable().optional(),
  colour: z.string().trim().max(100).nullable().optional(),
  costPriceMinor: z.number().int().min(0, "Cost price cannot be negative").nullable().optional(),
  priceMinor: z.number().int().min(0, "Price cannot be negative"),
  mrpMinor: z.number().int().min(0, "MRP cannot be negative").nullable().optional(),
  minPriceMinor: z.number().int().min(0, "Minimum price cannot be negative").nullable().optional(),
  taxRateBp: z.number().int().min(0).default(0),
  taxTreatment: z.nativeEnum(GstTaxTreatment).default(GstTaxTreatment.TAXABLE),
  taxExemptionRef: z.string().trim().max(200).nullable().optional(),
  taxRateMode: z.enum(["FIXED", "APPAREL_SLAB"]).optional(),
  openingQty: z.number().int().min(0).nullable().optional(),
  openingStock: z.array(z.object({
    storeId: z.string().min(1),
    quantity: z.number().int().min(0),
  })).optional(),
  isFreeSample: z.boolean().optional(),
  isActive: z.boolean().default(true),
}).superRefine((variant, ctx) => {
  // Step 5: If opening stock is specified (>0), cost price is required unless explicitly a free sample
  const hasOpening = (variant.openingStock && variant.openingStock.some(s => s.quantity > 0)) || (variant.openingQty != null && variant.openingQty > 0);
  if (hasOpening && !variant.isFreeSample) {
    if (variant.costPriceMinor == null || variant.costPriceMinor <= 0) {
      ctx.addIssue({
        code: "custom",
        message: "Cost price is required when opening stock is specified.",
        path: ["costPriceMinor"],
      });
    }
  }

  // If APPAREL_SLAB is chosen, taxRateBp will be computed dynamically by the server based on price
  if (variant.taxRateMode === "APPAREL_SLAB") {
    if (variant.taxTreatment !== GstTaxTreatment.TAXABLE) {
      ctx.addIssue({
        code: "custom",
        message: "Garment slab can only be used with TAXABLE treatment.",
        path: ["taxTreatment"],
      });
    }
    return;
  }

  const error = gstClassificationError({
    taxRateBp: variant.taxRateBp,
    taxTreatment: variant.taxTreatment,
    taxExemptionRef: variant.taxExemptionRef ?? null,
  });
  if (error) ctx.addIssue({ code: "custom", message: error, path: ["taxTreatment"] });
});

const schema = z.object({
  name: z.string().trim().min(1, "Product name is required").max(200),
  category: z.string().trim().max(100).nullable().optional(),
  brand: z.string().trim().max(100).nullable().optional(),
  imageUrl: z.string().trim().max(1000).nullable().optional().or(z.literal("")),
  hsnCode: z.string().trim().regex(/^\d{4,8}$/, "HSN code must be 4 to 8 digits").nullable().optional(),
  isActive: z.boolean().default(true),
  baseUomId: z.string().min(1, "Base unit of measure is required"),
  variant: variantItemSchema.optional(),
  variants: z.array(variantItemSchema).optional(),
});

export async function POST(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

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

    // Determine variant list: if `variants` array is provided and not empty, use that; otherwise fallback to single `variant`
    const rawVariants = (parsed.data.variants && parsed.data.variants.length > 0)
      ? parsed.data.variants
      : parsed.data.variant
        ? [parsed.data.variant]
        : [];

    if (rawVariants.length === 0) {
      return apiError({ code: "validation_error", message: "At least one variant is required.", status: 400, correlationId });
    }

    // Prepare all variants with auto-generated SKUs & barcodes if omitted
    const preparedVariants = [];
    for (let i = 0; i < rawVariants.length; i++) {
      const r = rawVariants[i]!;
      const sku =
        r.sku && r.sku.trim().length > 0
          ? r.sku.trim()
          : `SKU-${Date.now().toString().slice(-6)}-${Math.random().toString(36).substring(2, 5).toUpperCase()}${i > 0 ? `-${i}` : ""}`;

      // Without a barcode the catalogue service draws the next in-store code.
      const barcode = r.barcode?.trim() || null;

      preparedVariants.push({
        sku,
        barcode,
        size: r.size ?? null,
        colour: r.colour ?? null,
        costPriceMinor: r.costPriceMinor ?? null,
        priceMinor: r.priceMinor,
        mrpMinor: r.mrpMinor ?? null,
        minPriceMinor: r.minPriceMinor ?? null,
        taxRateBp: r.taxRateBp,
        taxTreatment: r.taxTreatment,
        taxExemptionRef: r.taxExemptionRef ?? null,
        taxRateMode: r.taxRateMode,
        openingQty: r.openingQty ?? null,
        openingStock: r.openingStock,
        isFreeSample: r.isFreeSample,
        isActive: r.isActive,
      });
    }

    // Atomically create product + all variants in ONE transaction
    const result = await createProduct({
      actor: {
        tenantId: resolved.context.tenantId,
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
      },
      storeId: resolved.context.storeId,
      name: parsed.data.name,
      category: parsed.data.category ?? null,
      brand: parsed.data.brand ?? null,
      imageUrl: parsed.data.imageUrl ? parsed.data.imageUrl : null,
      hsnCode: parsed.data.hsnCode ?? null,
      isActive: parsed.data.isActive,
      baseUomId: parsed.data.baseUomId,
      correlationId,
      variants: preparedVariants,
    });

    if (result.status !== "ok") {
      if (result.status === "unspecified_tax_treatment") {
        return apiError({
          code: "validation_error",
          message: "Statutory tax treatment UNSPECIFIED is prohibited. Variants must be classified as TAXABLE or NON_GST.",
          status: 422,
          correlationId,
        });
      }
      if (result.status === "invalid_tax_classification") {
        return apiError({ code: "validation_error", message: "Check the tax treatment, rate, and statutory reference.", status: 422, correlationId });
      }
      if (result.status === "price_exceeds_mrp") {
        return apiError({ code: "validation_error", message: "Variant sale price cannot exceed MRP.", status: 400, correlationId });
      }
      if (result.status === "price_below_minimum") {
        return apiError({ code: "validation_error", message: "Variant sale price cannot be below minimum selling price.", status: 400, correlationId });
      }
      if (result.status === "invalid_store") {
        return apiError({ code: "validation_error", message: result.message, status: 400, correlationId });
      }
      if (result.status === "duplicate_barcode") {
        return apiError({ code: "conflict", message: `Barcode "${result.barcode}" is already assigned to another variant.`, status: 409, correlationId });
      }
      if (result.status === "duplicate_sku") {
        return apiError({ code: "conflict", message: `SKU "${result.sku}" is already in use.`, status: 409, correlationId });
      }
      if (result.status === "duplicate_product_name") {
        const normName = normalizeProductKey(parsed.data.name);
        const cleanBrand = normalizeBrandValue(parsed.data.brand);
        const normBrand = normalizeProductKey(cleanBrand);

        const existing = await db.$queryRaw<Array<{
          id: string;
          name: string;
          brand: string | null;
          is_active: boolean;
          stock_count: number;
        }>>`
          SELECT
            p."id",
            p."name",
            p."brand",
            p."isActive" AS is_active,
            COALESCE(
              (SELECT SUM(sl."quantity")::int 
               FROM "stock_levels" sl 
               JOIN "product_variants" pv ON pv."id" = sl."variantId" 
               WHERE pv."productId" = p."id"), 0
            ) AS stock_count
          FROM "products" p
          WHERE p."tenantId" = ${resolved.context.tenantId}
            AND normalize_product_key(p."name") = ${normName}
            AND normalize_product_key(
              CASE 
                WHEN lower(trim(COALESCE(p."brand", ''))) = 'all' THEN '' 
                ELSE COALESCE(p."brand", '') 
              END
            ) = ${normBrand}
          LIMIT 1
        `;

        const match = existing[0];
        return NextResponse.json(
          {
            error: {
              code: "duplicate_product_name",
              message: `A product named "${parsed.data.name}" ${cleanBrand ? `under brand "${cleanBrand}" ` : ""}already exists in your catalogue.`,
              existingProduct: match
                ? {
                    id: match.id,
                    name: match.name,
                    brand: match.brand,
                    isActive: match.is_active,
                    stockCount: match.stock_count,
                  }
                : null,
            },
          },
          { status: 409 }
        );
      }
      if (result.status === "validation_error") {
        return apiError({ code: "validation_failed", message: result.message, status: 422, correlationId });
      }
      if (result.status === "forbidden") {
        return forbidden(correlationId, "You do not have permission to manage the catalogue.");
      }
      if (result.status === "not_found") {
        return apiError({ code: "not_found", message: "UOM not found.", status: 404, correlationId });
      }
      return apiError({ code: "conflict", message: "A variant with this SKU or barcode already exists.", status: 409, correlationId });
    }

    return NextResponse.json({
      status: "ok",
      productId: result.productId,
      variantId: result.variantId,
      variants: result.variants,
    }, { status: 201 });
  } catch (err: unknown) {
    logError("catalog: create product route failed", err);
    let userFriendlyMessage = "The product couldn't be saved due to an internal server error. Please try again.";

    if (err instanceof Error) {
      if (err.message.includes("Unknown argument")) {
        userFriendlyMessage = "System update pending: Please restart the server or run 'npx prisma generate' to sync models.";
      } else if (err.message.includes("Foreign key constraint failed")) {
        userFriendlyMessage = "One or more selected values (such as Store, Size, or UOM) could not be linked.";
      } else if (err.message.includes("Unique constraint failed") || err.message.includes("P2002")) {
        userFriendlyMessage = "A variant with this SKU or Barcode already exists.";
      }
    }

    return apiError({
      code: "service_unavailable",
      message: userFriendlyMessage,
      status: 500,
      correlationId,
    });
  }
}
