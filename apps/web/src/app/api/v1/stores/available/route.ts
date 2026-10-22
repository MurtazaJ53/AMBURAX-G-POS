import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { serviceUnavailable, unauthorized } from "@/lib/apiError";
import { resolveSession } from "@/server/identity/session";
import { listAvailableStores } from "@/server/tenant/storeSelection";

export const runtime = "nodejs";

/** A12: the stores the signed-in user may work in (SCREEN_API_MATRIX: GET /stores/available). */
export async function GET(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const token = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  try {
    const session = token ? await resolveSession(token) : null;
    if (!session) return unauthorized(correlationId);
    const stores = await listAvailableStores({
      tenantId: session.tenantId,
      userId: session.userId,
      tenantRole: session.user.tenantRole === "OWNER" ? "OWNER" : "STAFF",
    });
    return NextResponse.json({ status: "ok", stores, activeStoreId: session.activeStoreId, correlationId });
  } catch (err) {
    logError("stores/available: failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Stores are temporarily unavailable.");
  }
}
