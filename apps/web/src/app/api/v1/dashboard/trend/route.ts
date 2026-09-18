import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { getSalesTrend } from "@/server/dashboard/dashboardQueries";
import { isTrendRange } from "@/server/dashboard/dashboardTransforms";

export const runtime = "nodejs";

/**
 * The dashboard's sales trend, for the caller's own store.
 *
 * Exists because the range switcher has to re-query without reloading the page, and the
 * alternative — shipping all four ranges to the browser on first paint — would send thirty
 * days of buckets to render one.
 *
 * Note what the request cannot say: there is no tenant parameter and no store parameter. The
 * only store this endpoint can describe is the one the caller's session already resolves to,
 * so a crafted query string has nowhere to put someone else's business. The single input is
 * the range, and an unrecognised one is rejected rather than defaulted — silently serving
 * "today" for a typo would make the chart disagree with its own tab.
 */
export async function GET(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const range = req.nextUrl.searchParams.get("range") ?? "today";
    if (!isTrendRange(range)) {
      return apiError({
        code: "invalid_range",
        message: "That time range is not one this report covers.",
        status: 400,
        correlationId,
      });
    }

    const points = await getSalesTrend({
      tenantId: resolved.context.tenantId,
      storeId: resolved.context.storeId,
      range,
    });

    return NextResponse.json({ status: "ok", range, points, correlationId }, { status: 200 });
  } catch (err) {
    logError("dashboard: sales trend failed", err, { correlationId });
    return serviceUnavailable(correlationId, "The sales trend is temporarily unavailable.");
  }
}
