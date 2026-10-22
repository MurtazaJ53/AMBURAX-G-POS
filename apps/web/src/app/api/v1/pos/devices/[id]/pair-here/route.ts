import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, noStore } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { pairPosDeviceHere } from "@/server/pos/posDeviceLifecycle";

export const runtime = "nodejs";

/** One-click pairing from the till by a signed-in owner or store manager. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const { id } = await ctx.params;
  try {
    const resolved = await resolvePosContext(req.cookies.get(env.SESSION_COOKIE_NAME)?.value);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);
    const c = resolved.context;
    const result = await pairPosDeviceHere({
      actor: { tenantId: c.tenantId, userId: c.userId, tenantRole: c.tenantRole, membershipRole: c.membershipRole, storeId: c.storeId },
      posDeviceId: id,
      correlationId,
    });
    switch (result.status) {
      case "ok":
        return NextResponse.json({ status: "ok", device: result.device, correlationId });
      case "forbidden":
        return forbidden(correlationId, "Only the owner or a store manager can set up a till. Ask them to do it once on this computer.");
      case "disabled":
        return apiError({ code: "device_disabled", status: 409, message: "This terminal is disabled. Re-enable it in Settings → Terminals first.", correlationId });
      case "already_activated":
        return apiError({ code: "already_activated", status: 409, message: "This terminal is already set up.", correlationId });
      default:
        return apiError({ code: "not_found", status: 404, message: "Terminal not found.", correlationId });
    }
  } catch (err) {
    logError("pos/devices/pair-here: failed", err, { correlationId });
    return apiError({ code: "internal_error", status: 500, message: "Setting up the terminal didn't work. Try again.", correlationId });
  }
}
