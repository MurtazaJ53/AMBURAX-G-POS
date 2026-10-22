import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { unauthorized, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { searchCatalogPage, CATALOG_SEARCH_LIMIT, type CatalogFilters } from "@/server/sales/catalog";

export const runtime = "nodejs";

/** A short text filter, or nothing. */
const text = (v: string | null) => (v && v.trim() ? v.trim().slice(0, 60) : undefined);
/** A non-negative whole number of paise, or nothing. */
const paise = (v: string | null) => {
  if (v === null || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
};

/**
 * Catalogue lookup for the till: the typed query plus category / brand / size / colour / price
 * filters, a page at a time (`offset`), with `hasMore` for "Load more".
 *
 * Tenant and store come from the session, never from the query string, so there is no
 * parameter a client can use to read another tenant's catalogue or another store's counts.
 *
 * Prices are returned because the screen must show them, but they are informational: the
 * sale transaction re-reads every price from the database and ignores whatever the client
 * later sends back.
 */
export async function GET(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const sp = req.nextUrl.searchParams;
    const query = (sp.get("q") ?? "").slice(0, 100);
    const filters: CatalogFilters = {
      category: text(sp.get("category")),
      brand: text(sp.get("brand")),
      size: text(sp.get("size")),
      colour: text(sp.get("colour")),
      minPriceMinor: paise(sp.get("minPrice")),
      maxPriceMinor: paise(sp.get("maxPrice")),
    };
    // Deep paging is pointless at a till and costly in the database; past this, search or filter.
    const offset = Math.min(paise(sp.get("offset")) ?? 0, 5_000);

    const { results, hasMore } = await searchCatalogPage({
      tenantId: resolved.context.tenantId,
      storeId: resolved.context.storeId,
      query,
      filters,
      offset,
      limit: CATALOG_SEARCH_LIMIT,
    });

    return NextResponse.json({ status: "ok", results, hasMore, correlationId }, { status: 200 });
  } catch (err) {
    logError("catalog/search: lookup failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Product lookup is temporarily unavailable.");
  }
}
