import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { unauthorized, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { searchCatalog, CATALOG_SEARCH_LIMIT } from "@/server/sales/catalog";

export const runtime = "nodejs";

/**
 * Catalogue lookup for the till.
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

    const query = (req.nextUrl.searchParams.get("q") ?? "").slice(0, 100);

    const results = await searchCatalog({
      tenantId: resolved.context.tenantId,
      storeId: resolved.context.storeId,
      query,
      limit: CATALOG_SEARCH_LIMIT,
    });

    return NextResponse.json({ status: "ok", results, correlationId }, { status: 200 });
  } catch (err) {
    logError("catalog/search: lookup failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Product lookup is temporarily unavailable.");
  }
}
