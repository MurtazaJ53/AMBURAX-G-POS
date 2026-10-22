import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { unauthorized, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { getCatalogFacets } from "@/server/catalog/catalogQueries";

export const runtime = "nodejs";

/**
 * The till's filter options: the categories, brands, sizes and colours this tenant actually
 * sells, counted from its own rows.
 *
 * Read on demand rather than hard-coded, so a category added in the catalogue appears on the
 * till the next time it loads its filters — no release, no configuration. Tenant and store
 * come from the session, never from the query string.
 */
export async function GET(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const facets = await getCatalogFacets({
      tenantId: resolved.context.tenantId,
      storeId: resolved.context.storeId,
    });

    return NextResponse.json(
      {
        status: "ok",
        categories: facets.categories,
        brands: facets.brands,
        sizes: facets.sizes,
        colours: facets.colours,
        priceFloorMinor: facets.priceFloorMinor,
        priceCeilingMinor: facets.priceCeilingMinor,
        correlationId,
      },
      { status: 200 },
    );
  } catch (err) {
    logError("catalog/facets: lookup failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Filter options are temporarily unavailable.");
  }
}
