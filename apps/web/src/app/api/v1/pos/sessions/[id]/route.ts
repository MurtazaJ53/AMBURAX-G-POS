import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { closePosSession } from "@/server/pos/posSessionService";
import { posSessionErrorResponse } from "../route";

export const runtime = "nodejs";

/**
 * Close a shift.
 *
 * `closingNote` is free text and deliberately not a money figure — this endpoint records that a
 * shift ended, not that a drawer was counted. Cash reconciliation does not exist yet and is not
 * implied here.
 */
const closeSchema = z.object({ closingNote: z.string().trim().max(500).optional() });

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  const { id } = await ctx.params;

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    // An empty body is fine: closing without a note is the ordinary case.
    body = {};
  }

  const parsed = closeSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "validation_error",
      message: "That note is too long.",
      status: 400,
      correlationId,
    });
  }

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const result = await closePosSession({
      actor: {
        tenantId: resolved.context.tenantId,
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
        membershipRole: resolved.context.membershipRole,
      },
      sessionId: id,
      closingNote: parsed.data.closingNote,
      correlationId,
    });

    if (result.status !== "ok") return posSessionErrorResponse(result, correlationId);
    return NextResponse.json(
      { status: "ok", session: result.session, correlationId },
      { status: 200 },
    );
  } catch (err) {
    logError("pos session: close failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Closing a shift is temporarily unavailable.");
  }
}
