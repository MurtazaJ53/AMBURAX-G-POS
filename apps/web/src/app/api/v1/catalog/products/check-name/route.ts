import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { normalizeProductKey, normalizeBrandValue } from "@/server/catalog/productNormalization";

export const runtime = "nodejs";

export interface DuplicateCheckMatch {
  id: string;
  name: string;
  brand: string | null;
  isActive: boolean;
  stockCount: number;
  variantCount: number;
}

export interface CheckNameResult {
  exactMatch: DuplicateCheckMatch | null;
  similarMatches: DuplicateCheckMatch[];
}

/**
 * GET /api/v1/catalog/products/check-name?name=...&brand=...&excludeId=...
 *
 * Checks for:
 * 1. Exact match by (tenantId, normalized_name, normalized_brand)
 * 2. Similar matches (products whose normalized name contains or is contained in the query)
 */
export async function GET(req: NextRequest) {
  const correlationId = randomUUID();
  try {
    const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const { tenantId } = resolved.context;
    const url = new URL(req.url);
    const rawName = url.searchParams.get("name") || "";
    const rawBrand = url.searchParams.get("brand") || "";
    const excludeId = url.searchParams.get("excludeId") || null;

    const normName = normalizeProductKey(rawName);
    const cleanBrand = normalizeBrandValue(rawBrand);
    const normBrand = normalizeProductKey(cleanBrand);

    if (!normName) {
      return NextResponse.json({ exactMatch: null, similarMatches: [] });
    }

    // 1. Check exact match using database function
    const exactMatches = await db.$queryRaw<Array<{
      id: string;
      name: string;
      brand: string | null;
      is_active: boolean;
      variant_count: number;
      stock_count: number;
    }>>`
      SELECT
        p."id",
        p."name",
        p."brand",
        p."isActive" AS is_active,
        (SELECT COUNT(*)::int FROM "product_variants" pv WHERE pv."productId" = p."id") AS variant_count,
        COALESCE(
          (SELECT SUM(sl."quantity")::int 
           FROM "stock_levels" sl 
           JOIN "product_variants" pv ON pv."id" = sl."variantId" 
           WHERE pv."productId" = p."id"), 0
        ) AS stock_count
      FROM "products" p
      WHERE p."tenantId" = ${tenantId}
        AND (${excludeId}::text IS NULL OR p."id" != ${excludeId}::text)
        AND normalize_product_key(p."name") = ${normName}
        AND normalize_product_key(
          CASE 
            WHEN lower(trim(COALESCE(p."brand", ''))) = 'all' THEN '' 
            ELSE COALESCE(p."brand", '') 
          END
        ) = ${normBrand}
      LIMIT 1
    `;

    const exactMatch: DuplicateCheckMatch | null = exactMatches[0]
      ? {
          id: exactMatches[0].id,
          name: exactMatches[0].name,
          brand: exactMatches[0].brand,
          isActive: exactMatches[0].is_active,
          stockCount: exactMatches[0].stock_count,
          variantCount: exactMatches[0].variant_count,
        }
      : null;

    // 2. Similar matches (exclude the exact match)
    const exactId = exactMatch?.id || "00000000-0000-0000-0000-000000000000";
    const similarRows = await db.$queryRaw<Array<{
      id: string;
      name: string;
      brand: string | null;
      is_active: boolean;
      variant_count: number;
      stock_count: number;
    }>>`
      SELECT
        p."id",
        p."name",
        p."brand",
        p."isActive" AS is_active,
        (SELECT COUNT(*)::int FROM "product_variants" pv WHERE pv."productId" = p."id") AS variant_count,
        COALESCE(
          (SELECT SUM(sl."quantity")::int 
           FROM "stock_levels" sl 
           JOIN "product_variants" pv ON pv."id" = sl."variantId" 
           WHERE pv."productId" = p."id"), 0
        ) AS stock_count
      FROM "products" p
      WHERE p."tenantId" = ${tenantId}
        AND p."id" != ${exactId}
        AND (${excludeId}::text IS NULL OR p."id" != ${excludeId}::text)
        AND (
          normalize_product_key(p."name") LIKE '%' || ${normName} || '%'
          OR ${normName} LIKE '%' || normalize_product_key(p."name") || '%'
        )
      LIMIT 5
    `;

    const similarMatches: DuplicateCheckMatch[] = similarRows.map((r) => ({
      id: r.id,
      name: r.name,
      brand: r.brand,
      isActive: r.is_active,
      stockCount: r.stock_count,
      variantCount: r.variant_count,
    }));

    return NextResponse.json({ exactMatch, similarMatches });
  } catch (err) {
    logError("catalog/products: check-name failed", err, { correlationId });
    return apiError({ code: "internal_error", status: 500, message: "Could not check product name.", correlationId });
  }
}
