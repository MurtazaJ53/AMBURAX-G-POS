import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { db } from "@/server/db";

export const runtime = "nodejs";

/**
 * Returns the store's sellable product catalog snapshot for offline local storage (IndexedDB).
 * Only active products and variants with their price, barcode, SKU, and tax rates.
 */
export async function GET(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const c = resolved.context;

    const variants = await db.productVariant.findMany({
      where: {
        tenantId: c.tenantId,
        isActive: true,
        product: { isActive: true, isDraft: false },
      },
      select: {
        id: true,
        sku: true,
        barcode: true,
        size: true,
        colour: true,
        priceMinor: true,
        taxRateBp: true,
        taxRateMode: true,
        taxTreatment: true,
        product: {
          select: {
            id: true,
            name: true,
            category: true,
            brand: true,
          },
        },
      },
      take: 2000,
    });

    const items = variants.map((v) => ({
      variantId: v.id,
      productName: v.product.name,
      sku: v.sku,
      barcode: v.barcode,
      size: v.size,
      colour: v.colour,
      priceMinor: v.priceMinor,
      taxRateBp: v.taxRateBp,
      taxRateMode: v.taxRateMode,
      taxTreatment: v.taxTreatment,
      category: v.product.category,
      brand: v.product.brand,
      isActive: true,
    }));

    return NextResponse.json({
      status: "ok",
      items,
      count: items.length,
      syncedAt: new Date().toISOString(),
      correlationId,
    });
  } catch (err) {
    logError("pos offline-catalog sync failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Offline catalog sync is unavailable.");
  }
}
