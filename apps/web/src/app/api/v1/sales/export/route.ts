import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, noStore, serviceUnavailable, unauthorized } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { parseSalesFiltersStrict } from "@/server/sales/salesFilterParams";
import { listSalesForExport } from "@/server/sales/saleQueries";
import { toSalesCsv } from "@/server/sales/salesCsv";

export const runtime = "nodejs";

/**
 * CSV of the Sales screen's current filtered list.
 *
 * Same access as the Sales screen (an authenticated session with a store); tenant and store come
 * only from the session, never the query string. Filters are parsed strictly — an invalid one is
 * refused rather than silently widening the file. More than SALES_EXPORT_MAX_ROWS rows is refused,
 * never truncated.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();

  try {
    const resolved = await resolvePosContext(req.cookies.get(env.SESSION_COOKIE_NAME)?.value);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const parsed = parseSalesFiltersStrict((name) => req.nextUrl.searchParams.get(name));
    if (!parsed.ok) {
      return apiError({ code: "invalid_filter", message: parsed.reason, status: 400, correlationId });
    }

    const result = await listSalesForExport({
      tenantId: resolved.context.tenantId,
      storeId: resolved.context.storeId,
      ...parsed.filters,
    });
    if (result.status === "too_many_rows") {
      return apiError({
        code: "export_too_large",
        message: `This export has ${result.total} sales; the limit is ${result.max}. Narrow the date range or filters and try again.`,
        status: 422,
        correlationId,
      });
    }

    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(toSalesCsv(result.rows), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sales-${stamp}.csv"`,
        "Cache-Control": "no-store",
        "X-Correlation-Id": correlationId,
      },
    });
  } catch (err) {
    logError("sales/export: failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Sales export is temporarily unavailable.");
  }
}
