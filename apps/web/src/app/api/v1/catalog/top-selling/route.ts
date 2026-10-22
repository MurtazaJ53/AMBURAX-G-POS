import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { unauthorized, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { db } from "@/server/db";
import type { CatalogHit } from "@/server/sales/catalog";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const { tenantId, storeId } = resolved.context;

    // Find top sold variants in this store (or tenant)
    const topSaleItems = await db.saleItem.groupBy({
      by: ["skuSnapshot"],
      where: {
        sale: {
          tenantId,
          storeId,
          status: "COMPLETED",
        },
      },
      _sum: { quantity: true },
      orderBy: {
        _sum: {
          quantity: "desc",
        },
      },
      take: 10,
    });

    const topSkus = topSaleItems.map((item) => item.skuSnapshot);

    type VariantQueryResult = {
      id: string;
      sku: string;
      barcode: string | null;
      size: string | null;
      colour: string | null;
      priceMinor: number;
      mrpMinor: number | null;
      taxRateBp: number;
      taxRateMode: "FIXED" | "APPAREL_SLAB";
      taxTreatment: string;
      product: { name: string; imageUrl: string | null };
      stockLevels: { quantity: number }[];
    };

    let variants: VariantQueryResult[] = [];
    if (topSkus.length > 0) {
      variants = await db.productVariant.findMany({
        where: {
          tenantId,
          sku: { in: topSkus },
          isActive: true,
          product: { isActive: true },
        },
        select: {
          id: true,
          sku: true,
          barcode: true,
          size: true,
          colour: true,
          priceMinor: true,
          mrpMinor: true,
          taxRateBp: true,
          taxRateMode: true,
          taxTreatment: true,
          product: { select: { name: true, imageUrl: true } },
          stockLevels: { where: { storeId }, select: { quantity: true } },
        },
      });
    }

    // Fallback: If not enough sales yet, pull active variants in this store
    if (variants.length < 10) {
      const needed = 10 - variants.length;
      const existingIds = variants.map((v) => v.id);
      const fallback = await db.productVariant.findMany({
        where: {
          tenantId,
          id: { notIn: existingIds },
          isActive: true,
          product: { isActive: true },
        },
        take: needed,
        orderBy: [{ product: { name: "asc" } }, { sku: "asc" }],
        select: {
          id: true,
          sku: true,
          barcode: true,
          size: true,
          colour: true,
          priceMinor: true,
          mrpMinor: true,
          taxRateBp: true,
          taxRateMode: true,
          taxTreatment: true,
          product: { select: { name: true, imageUrl: true } },
          stockLevels: { where: { storeId }, select: { quantity: true } },
        },
      });
      variants.push(...fallback);
    }

    const items: CatalogHit[] = variants.map((v) => ({
      variantId: v.id,
      productName: v.product.name,
      sku: v.sku,
      barcode: v.barcode,
      size: v.size,
      colour: v.colour,
      priceMinor: v.priceMinor,
      mrpMinor: v.mrpMinor ?? null,
      taxRateBp: v.taxRateBp,
      taxRateMode: v.taxRateMode,
      taxTreatment: v.taxTreatment,
      stockQuantity: v.stockLevels[0]?.quantity ?? null,
      imageUrl: v.product.imageUrl ?? null,
    }));

    return NextResponse.json({ status: "ok", items, correlationId });
  } catch (err) {
    logError("catalog:top-selling: failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Failed to load top selling items.");
  }
}
