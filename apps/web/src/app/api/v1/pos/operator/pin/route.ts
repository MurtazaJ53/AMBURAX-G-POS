import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore, forbidden } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { setPinForStaff } from "@/server/identity/approvalPin";

export const runtime = "nodejs";

const body = z.object({ userId: z.string().trim().min(1), pin: z.string().trim().max(12).nullable() }).strict();

/** Owner or store manager sets (or clears, `pin: null`) a team member's till PIN. */
export async function POST(req: NextRequest) {
  const correlationId = randomUUID();
  try {
    const resolved = await resolvePosContext(req.cookies.get(env.SESSION_COOKIE_NAME)?.value);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return apiError({ code: "validation_error", status: 400, message: "Enter a 4 to 6 digit PIN.", correlationId });
    const c = resolved.context;
    const res = await setPinForStaff({
      tenantId: c.tenantId,
      storeId: c.storeId,
      actorUserId: c.userId,
      targetUserId: parsed.data.userId,
      pin: parsed.data.pin,
    });
    if (res.status === "ok") return NextResponse.json({ status: "ok", correlationId });
    if (res.status === "invalid_pin") return apiError({ code: "invalid_pin", status: 400, message: res.reason, correlationId });
    return forbidden(correlationId, "Only the owner or a store manager can set team PINs, and only the owner sets their own.");
  } catch (err) {
    logError("pos/operator/pin: failed", err, { correlationId });
    return apiError({ code: "internal_error", status: 500, message: "Couldn't save the PIN.", correlationId });
  }
}
