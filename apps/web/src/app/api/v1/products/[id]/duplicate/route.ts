import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore, forbidden } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { canManageCatalog } from "@/server/catalog/catalogRoles";
import { createProduct } from "@/server/catalog/catalogService";
import { generateUniqueShortBarcode } from "@/server/catalog/barcodeGenerator";

export const runtime = "nodejs";

/**
 * POST /api/v1/products/[id]/duplicate
 * Clones a product with all its variant combinations and structure, asking for a new name.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = randomUUID();
  try {
    const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const { tenantId, userId, tenantRole, storeId } = resolved.context;
    if (!canManageCatalog(tenantRole)) {
      return forbidden(correlationId, "Your role cannot duplicate products.");
    }

    const { id: sourceProductId } = await params;
    const body = await req.json().catch(() => null);
    const newName = body?.name?.trim();

    if (!newName) {
      return apiError({ code: "validation_error", status: 400, message: "Enter a new name for the duplicated product.", correlationId });
    }

    // Read source product with variants
    const sourceProduct = await db.product.findUnique({
      where: { id_tenantId: { id: sourceProductId, tenantId } },
      include: {
        variants: {
          where: { isActive: true },
        },
      },
    });

    if (!sourceProduct) {
      return apiError({ code: "not_found", status: 404, message: "Source product not found.", correlationId });
    }

    // Build variants for clone with fresh auto-generated SKUs and Barcodes
    const preparedVariants = [];
    for (let i = 0; i < sourceProduct.variants.length; i++) {
      const sv = sourceProduct.variants[i]!;
      const tag = Math.random().toString(36).substring(2, 6).toUpperCase();
      const newSku = `SKU-${newName.slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, "")}-${sv.size || "STD"}-${tag}`;
      const newBarcode = await generateUniqueShortBarcode(tenantId);

      preparedVariants.push({
        sku: newSku,
        barcode: newBarcode,
        size: sv.size,
        colour: sv.colour,
        costPriceMinor: sv.costPriceMinor,
        priceMinor: sv.priceMinor,
        mrpMinor: sv.mrpMinor,
        taxRateBp: sv.taxRateBp,
        taxTreatment: sv.taxTreatment,
        taxExemptionRef: sv.taxExemptionRef,
        taxRateMode: sv.taxRateMode,
        isActive: true,
      });
    }

    const createRes = await createProduct({
      actor: { tenantId, userId, tenantRole },
      storeId,
      name: newName,
      category: sourceProduct.category,
      brand: sourceProduct.brand,
      imageUrl: sourceProduct.imageUrl,
      hsnCode: sourceProduct.hsnCode,
      isActive: true,
      baseUomId: sourceProduct.baseUomId,
      correlationId,
      variants: preparedVariants,
    });

    if (createRes.status !== "ok") {
      if (createRes.status === "duplicate_product_name") {
        return apiError({
          code: "duplicate_product_name",
          status: 409,
          message: `A product named "${newName}" already exists under brand "${sourceProduct.brand || "None"}".`,
          correlationId,
        });
      }
      return apiError({ code: "internal_error", status: 500, message: "Failed to duplicate product.", correlationId });
    }

    return NextResponse.json({
      status: "ok",
      productId: createRes.productId,
      correlationId,
    }, { status: 201 });
  } catch (err) {
    logError("products: duplicate failed", err, { correlationId });
    return apiError({ code: "internal_error", status: 500, message: "Could not duplicate product.", correlationId });
  }
}
