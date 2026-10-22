import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { serviceUnavailable, unauthorized } from "@/lib/apiError";
import { resolveSession } from "@/server/identity/session";
import { listActiveSessions, revokeOtherSessions } from "@/server/identity/securityCenter";

export const runtime = "nodejs";

/** A14: the caller's own active sessions. No token or token hash is ever returned. */
export async function GET(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const token = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  try {
    const session = token ? await resolveSession(token) : null;
    if (!session) return unauthorized(correlationId);
    const sessions = await listActiveSessions({
      userId: session.userId,
      tenantId: session.tenantId,
      currentSessionId: session.id,
    });
    return NextResponse.json({ status: "ok", sessions, correlationId });
  } catch (err) {
    logError("sessions: list failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Sessions are temporarily unavailable.");
  }
}

/** A14: sign out every other device, keeping the caller's own session. */
export async function DELETE(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const token = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  try {
    const session = token ? await resolveSession(token) : null;
    if (!session) return unauthorized(correlationId);
    const { revoked } = await revokeOtherSessions({
      userId: session.userId,
      tenantId: session.tenantId,
      keepSessionId: session.id,
    });
    return NextResponse.json({ status: "ok", revoked, correlationId });
  } catch (err) {
    logError("sessions: revoke others failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Couldn't sign other devices out right now.");
  }
}
