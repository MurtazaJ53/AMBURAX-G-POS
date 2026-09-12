import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { getSaleDetail } from "@/server/sales/saleQueries";

export const runtime = "nodejs";

/**
 * One sale, for the bill.
 *
 * The lookup is tenant-scoped, so a sale id belonging to another tenant produces the same
 * 404 as an id that never existed. Guessing ids reveals nothing — not even whether the
 * sale exists.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  const { id } = await ctx.params;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const sale = await getSaleDetail({ tenantId: resolved.context.tenantId, saleId: id });

    if (!sale) {
      return apiError({
        code: "not_found",
        message: "That sale could not be found.",
        status: 404,
        correlationId,
      });
    }

    return NextResponse.json({ status: "ok", sale, correlationId }, { status: 200 });
  } catch (err) {
    logError("sales/[id]: lookup failed", err, { correlationId });
    return serviceUnavailable(correlationId, "That bill is temporarily unavailable.");
  }
}
