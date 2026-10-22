import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, forbidden, serviceUnavailable, unauthorized } from "@/lib/apiError";
import { resolveSession } from "@/server/identity/session";
import { selectActiveStore } from "@/server/tenant/storeSelection";

export const runtime = "nodejs";

const bodySchema = z.object({ storeId: z.string().trim().min(1).max(64) });

/** A12: switch this session's working store (SCREEN_API_MATRIX: POST /context). */
export async function POST(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const token = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError({ code: "invalid_request", message: "Malformed request body.", status: 400, correlationId });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError({ code: "validation_error", message: "Choose a store.", status: 400, correlationId });
  }
  try {
    const session = token ? await resolveSession(token) : null;
    if (!session) return unauthorized(correlationId);
    const res = await selectActiveStore({
      sessionId: session.id,
      tenantId: session.tenantId,
      userId: session.userId,
      tenantRole: session.user.tenantRole === "OWNER" ? "OWNER" : "STAFF",
      storeId: parsed.data.storeId,
      correlationId,
    });
    if (res.status === "forbidden") return forbidden(correlationId, "You don't have access to that store.");
    return NextResponse.json({ status: "ok", storeId: res.storeId, correlationId });
  } catch (err) {
    logError("context: switch failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Couldn't switch store right now.");
  }
}
