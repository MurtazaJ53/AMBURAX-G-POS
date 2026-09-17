import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { repairPosDevice } from "@/server/pos/posDeviceLifecycle";

export const runtime = "nodejs";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  const { id } = await ctx.params;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const result = await repairPosDevice({
      actor: {
        tenantId: resolved.context.tenantId,
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
        membershipRole: resolved.context.membershipRole,
        storeId: resolved.context.storeId,
      },
      posDeviceId: id,
      correlationId,
    });

    switch (result.status) {
      case "ok":
        return NextResponse.json({
          status: "ok",
          pairingCode: result.pairingCode,
          pairingExpiresAt: result.pairingExpiresAt.toISOString(),
        });
      case "forbidden":
        return forbidden(correlationId, "You do not have permission to manage POS terminals.");
      case "not_found":
      case "capability_disabled":
        return apiError({ code: "not_found", status: 404, message: "Terminal not found.", correlationId });
      case "not_disabled":
        return apiError({ code: "not_disabled", status: 400, message: "Terminal must be disabled before re-pairing.", correlationId });
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("ECONNREFUSED")) {
      return serviceUnavailable(correlationId, "Service unavailable.");
    }
    logError("Unhandled error in POST /pos/devices/[id]/re-pair", error);
    return apiError({ code: "internal_error", status: 500, message: "An unexpected error occurred.", correlationId });
  }
}
