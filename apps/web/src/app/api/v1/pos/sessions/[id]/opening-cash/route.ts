import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore, forbidden } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { z } from "zod";
import { setOpeningFloat } from "@/server/pos/cashRegister";

export const runtime = "nodejs";

const body = z.object({ amountMinor: z.number().int().min(0).max(10_000_000_00) });

/** Record a shift's opening cash (once). Same rules as Cash & Day Close: the shift's cashier, the owner or a store manager. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const correlationId = randomUUID();
  const { id } = await ctx.params;
  try {
    const resolved = await resolvePosContext(req.cookies.get(env.SESSION_COOKIE_NAME)?.value);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return apiError({ code: "validation_error", status: 400, message: "Enter the opening cash in rupees.", correlationId });
    const c = resolved.context;
    const res = await setOpeningFloat({
      actor: { tenantId: c.tenantId, userId: c.userId, tenantRole: c.tenantRole },
      sessionId: id,
      amountMinor: parsed.data.amountMinor,
      correlationId,
    });
    switch (res.status) {
      case "ok":
        return NextResponse.json({ status: "ok", correlationId });
      case "forbidden":
        return forbidden(correlationId, "Only the cashier on this shift, the owner or a store manager can record its cash.");
      case "not_found":
        return apiError({ code: "not_found", status: 404, message: "That shift no longer exists.", correlationId });
      default:
        return apiError({ code: res.status, status: 409, message: res.reason, correlationId });
    }
  } catch (err) {
    logError("pos/sessions/opening-cash: failed", err, { correlationId });
    return apiError({ code: "internal_error", status: 500, message: "Couldn't record the opening cash.", correlationId });
  }
}
