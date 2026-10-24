import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore, forbidden } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { canManageInventory } from "@/server/inventory/inventoryRoles";
import { createVariant } from "@/server/catalog/catalogService";
import { searchPurchaseItems, type PurchaseVariantHit } from "@/server/purchasing/purchaseItems";

export const runtime = "nodejs";

function skuPart(text: string, max: number): string {
  return text
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "")
    .toUpperCase()
    .slice(0, max);
}

/**
 * Option A: Instant creation of new size/colour variants for an existing product
 * directly inside the Purchase Entry / SizeGrid workflow.
 *
 * Inherits parent tax treatment, UOM, and brand; auto-generates clean SKUs and EAN-8 barcodes.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = randomUUID();
  try {
    const resolved = await resolvePosContext(req.cookies.get(env.SESSION_COOKIE_NAME)?.value);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);
    const c = resolved.context;
    if (!canManageInventory(c)) return forbidden(correlationId, "Your role cannot manage products.");

    const { id: productId } = await params;
    const body = await req.json().catch(() => null);

    const {
      sizes, // array of sizes e.g. ["XXL"]
      colour, // single colour e.g. "Olive" or null/""
      costPriceMinor,
      priceMinor,
      mrpMinor,
      barcode, // optional custom manufacturer barcode
    } = body || {};

    if (!Array.isArray(sizes) || sizes.length === 0) {
      return apiError({ code: "validation_error", status: 400, message: "Select or enter at least one size.", correlationId });
    }
    if (typeof priceMinor !== "number" || priceMinor <= 0) {
      return apiError({ code: "validation_error", status: 400, message: "Valid selling price is required.", correlationId });
    }
    if (typeof mrpMinor === "number" && priceMinor > mrpMinor) {
      return apiError({ code: "validation_error", status: 400, message: "Selling price cannot exceed MRP.", correlationId });
    }

    // Verify parent product exists and fetch sibling variant for inheriting tax rates & tags
    const parentProduct = await db.product.findFirst({
      where: { id: productId, tenantId: c.tenantId },
      include: {
        variants: {
          where: { isActive: true },
          take: 1,
        },
      },
    });

    if (!parentProduct) {
      return apiError({ code: "not_found", status: 404, message: "Product not found.", correlationId });
    }

    const sibling = parentProduct.variants[0];
    const taxRules = sibling
      ? {
          taxTreatment: sibling.taxTreatment,
          taxRateMode: sibling.taxRateMode,
          taxRateBp: sibling.taxRateBp,
          taxExemptionRef: sibling.taxExemptionRef,
        }
      : {
          taxTreatment: "TAXABLE" as const,
          taxRateMode: "APPAREL_SLAB" as const,
          taxRateBp: 0,
          taxExemptionRef: null,
        };

    const cleanColour = typeof colour === "string" && colour.trim() ? colour.trim() : null;
    const prodBase = skuPart(parentProduct.name, 8) || "ITEM";
    const clrPart = cleanColour ? skuPart(cleanColour, 4) : "";

    const catalogActor = {
      tenantId: c.tenantId,
      userId: c.userId,
      tenantRole: c.tenantRole,
      membershipRole: c.membershipRole,
    };

    const createdVariants: PurchaseVariantHit[] = [];

    for (const rawSize of sizes) {
      const cleanSize = String(rawSize).trim();
      if (!cleanSize) continue;

      const szPart = skuPart(cleanSize, 4) || "STD";
      const tag = Math.random().toString(36).slice(2, 6).toUpperCase();
      const generatedSku = [prodBase, clrPart, szPart, tag].filter(Boolean).join("-");
      const suppliedBarcode = barcode?.trim() || null;

      const vRes = await createVariant({
        actor: catalogActor,
        productId: parentProduct.id,
        sku: generatedSku,
        barcode: suppliedBarcode,
        size: cleanSize,
        colour: cleanColour,
        costPriceMinor: typeof costPriceMinor === "number" ? costPriceMinor : sibling?.costPriceMinor ?? null,
        priceMinor,
        mrpMinor: typeof mrpMinor === "number" ? mrpMinor : sibling?.mrpMinor ?? null,
        isActive: true,
        correlationId,
        ...taxRules,
      });

      if (vRes.status === "duplicate_barcode") {
        return apiError({ code: "conflict", status: 409, message: `Barcode ${vRes.barcode} is already in use.`, correlationId });
      }
      if (vRes.status === "duplicate_sku") {
        return apiError({ code: "conflict", status: 409, message: `SKU ${vRes.sku} already exists.`, correlationId });
      }
      if (vRes.status !== "ok") {
        return apiError({ code: "internal_error", status: 500, message: "Could not create variant.", correlationId });
      }

      createdVariants.push({
        variantId: vRes.variantId,
        sku: generatedSku,
        barcode: vRes.barcode,
        size: cleanSize,
        colour: cleanColour,
        priceMinor,
        mrpMinor: typeof mrpMinor === "number" ? mrpMinor : sibling?.mrpMinor ?? null,
        costPriceMinor: typeof costPriceMinor === "number" ? costPriceMinor : sibling?.costPriceMinor ?? null,
        stock: 0,
        lastCostMinor: typeof costPriceMinor === "number" ? costPriceMinor : sibling?.costPriceMinor ?? null,
        lastGstRateBp: sibling?.taxRateBp ?? null,
        productGstRateBp: sibling?.taxRateBp ?? null,
      });
    }

    return NextResponse.json({
      status: "ok",
      variants: createdVariants,
      correlationId,
    });
  } catch (err) {
    logError("products/variants: quick create failed", err, { correlationId });
    return apiError({ code: "internal_error", status: 500, message: "Could not create new variants.", correlationId });
  }
}
