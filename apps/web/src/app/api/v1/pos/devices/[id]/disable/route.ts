import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { disablePosDevice } from "@/server/pos/posDeviceLifecycle";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const result = await disablePosDevice({
      actor: {
        tenantId: resolved.tenantId,
        userId: resolved.user.id,
        tenantRole: resolved.user.tenantRole,
        membershipRole: resolved.membershipRole,
      },
      posDeviceId: params.id,
      correlationId,
    });

    switch (result.status) {
      case "ok":
        return NextResponse.json({ status: "ok" });
      case "forbidden":
        return forbidden("You do not have permission to manage POS terminals.", correlationId);
      case "not_found":
      case "capability_disabled":
        return apiError(404, "not_found", "Terminal not found.", correlationId);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("ECONNREFUSED")) {
      return serviceUnavailable(correlationId);
    }
    logError("Unhandled error in POST /pos/devices/[id]/disable", error);
    return apiError(500, "internal_error", "An unexpected error occurred.", correlationId);
  }
}
