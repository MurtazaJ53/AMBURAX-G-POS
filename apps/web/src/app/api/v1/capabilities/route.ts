import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { unauthorized, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { listCapabilities } from "@/server/capability/capabilityService";

export const runtime = "nodejs";

/**
 * The caller's own tenant capabilities — every capability with its on/off state.
 *
 * There is no tenant parameter, and that is the isolation guarantee: the only tenant this
 * endpoint can describe is the one in the caller's session. Tenant A cannot ask about Tenant B
 * because the request has nowhere to put "B".
 *
 * Readable by any authenticated member. Knowing which modules your own employer has switched on
 * is not sensitive, and a staff user whose screen depends on it should not need owner rights to
 * find out. Changing the configuration is a different matter — see the [capability] route.
 */
export async function GET(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const capabilities = await listCapabilities(resolved.context.tenantId);
    return NextResponse.json({ status: "ok", capabilities, correlationId }, { status: 200 });
  } catch (err) {
    logError("capabilities: list failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Capabilities are temporarily unavailable.");
  }
}
