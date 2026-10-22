import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore, forbidden } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { db } from "@/server/db";
import { openingFloatOf, suggestedOpeningFloat } from "@/server/pos/cashRegister";

export const runtime = "nodejs";

/**
 * Opening cash for the till's start-of-shift step: the suggestion (cash counted at this terminal's
 * last close) and, when `sessionId` is given, what that shift already recorded.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const correlationId = randomUUID();
  const { id } = await ctx.params;
  try {
    const resolved = await resolvePosContext(req.cookies.get(env.SESSION_COOKIE_NAME)?.value);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);
    const c = resolved.context;
    const device = await db.posDevice.findFirst({ where: { id, tenantId: c.tenantId, storeId: c.storeId }, select: { id: true } });
    if (!device) return apiError({ code: "not_found", status: 404, message: "Terminal not found.", correlationId });
    const suggestion = await suggestedOpeningFloat({ tenantId: c.tenantId, posDeviceId: id });
    const sessionId = req.nextUrl.searchParams.get("sessionId");
    const sessionFloatMinor = sessionId ? await openingFloatOf({ tenantId: c.tenantId, sessionId }) : null;
    return NextResponse.json({ status: "ok", ...suggestion, sessionFloatMinor, correlationId });
  } catch (err) {
    logError("pos/devices/opening-cash: failed", err, { correlationId });
    return apiError({ code: "internal_error", status: 500, message: "Couldn't load the opening cash.", correlationId });
  }
}
