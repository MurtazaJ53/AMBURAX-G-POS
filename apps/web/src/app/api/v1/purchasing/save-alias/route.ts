import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore, forbidden } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { canManageInventory } from "@/server/inventory/inventoryRoles";
import { normaliseBillText } from "@/server/purchasing/billScan";

export const runtime = "nodejs";

/**
 * Save a learned supplier item alias so future scans of bills from this supplier
 * with this exact text match deterministically with 100% confidence.
 */
export async function POST(req: NextRequest) {
  const correlationId = randomUUID();
  try {
    const resolved = await resolvePosContext(req.cookies.get(env.SESSION_COOKIE_NAME)?.value);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);
    const c = resolved.context;
    if (!canManageInventory(c)) return forbidden(correlationId, "Your role cannot manage purchases.");

    const body = await req.json().catch(() => null);
    const { supplierId, billText, variantId } = body || {};

    if (!supplierId || typeof supplierId !== "string") {
      return apiError({ code: "validation_error", status: 400, message: "Valid supplierId is required.", correlationId });
    }
    if (!billText || typeof billText !== "string" || !billText.trim()) {
      return apiError({ code: "validation_error", status: 400, message: "Bill text is required.", correlationId });
    }
    if (!variantId || typeof variantId !== "string") {
      return apiError({ code: "validation_error", status: 400, message: "Valid variantId is required.", correlationId });
    }

    const cleanText = normaliseBillText(billText);
    if (!cleanText) {
      return apiError({ code: "validation_error", status: 400, message: "Clean bill text cannot be empty.", correlationId });
    }

    // Verify supplier and variant belong to this tenant
    const [supplier, variant] = await Promise.all([
      db.supplier.findFirst({ where: { id: supplierId, tenantId: c.tenantId }, select: { id: true } }),
      db.productVariant.findFirst({ where: { id: variantId, tenantId: c.tenantId }, select: { id: true } }),
    ]);

    if (!supplier) {
      return apiError({ code: "not_found", status: 404, message: "Supplier not found.", correlationId });
    }
    if (!variant) {
      return apiError({ code: "not_found", status: 404, message: "Variant not found.", correlationId });
    }

    // Upsert alias
    const alias = await db.supplierItemAlias.upsert({
      where: {
        tenantId_supplierId_text: {
          tenantId: c.tenantId,
          supplierId: supplier.id,
          text: cleanText,
        },
      },
      update: {
        variantId: variant.id,
      },
      create: {
        tenantId: c.tenantId,
        supplierId: supplier.id,
        text: cleanText,
        variantId: variant.id,
      },
    });

    return NextResponse.json({ status: "ok", aliasId: alias.id, correlationId });
  } catch (err) {
    logError("purchasing/save-alias: failed", err, { correlationId });
    return apiError({ code: "internal_error", status: 500, message: "Could not record supplier alias.", correlationId });
  }
}
