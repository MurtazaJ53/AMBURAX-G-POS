import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { listPosDevices } from "@/server/pos/posDeviceQueries";

export const runtime = "nodejs";

/**
 * The terminals in the caller's own store.
 *
 * There is no tenant or store parameter, and that absence is the isolation guarantee: both are
 * read from the session, so there is nowhere for a client to put another tenant's identifiers.
 *
 * A disabled RETAIL capability answers 404, not 403, per the P1-7 freeze — whether a tenant has
 * a module is not something their API surface volunteers.
 */
export async function GET(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const result = await listPosDevices({
      tenantId: resolved.context.tenantId,
      storeId: resolved.context.storeId,
    });

    if (result.status === "capability_disabled") {
      return apiError({ code: "not_found", message: "Not found.", status: 404, correlationId });
    }

    return NextResponse.json(
      { status: "ok", devices: result.devices, correlationId },
      { status: 200 },
    );
  } catch (err) {
    logError("pos/devices: list failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Terminals are temporarily unavailable.");
  }
}
