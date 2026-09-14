import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { setCustomerGstin } from "@/server/address/addressService";

export const runtime = "nodejs";

/** `null` clears it. Most retail customers have none, and that is a permanent state. */
const gstinSchema = z.object({ gstin: z.string().nullable() });

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError({
      code: "invalid_request",
      message: "Malformed request body.",
      status: 400,
      correlationId,
    });
  }

  const parsed = gstinSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "validation_error",
      message: "Send a GSTIN, or null to clear it.",
      status: 400,
      correlationId,
    });
  }

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const result = await setCustomerGstin({
      tenantId: resolved.context.tenantId,
      actorUserId: resolved.context.userId,
      customerId: id,
      gstin: parsed.data.gstin,
      correlationId,
    });

    if (result.status === "not_found") {
      return apiError({
        code: "not_found",
        message: "That customer could not be found.",
        status: 404,
        correlationId,
      });
    }
    if (result.status === "validation_error") {
      return apiError({
        code: "validation_error",
        message: result.reason,
        status: 400,
        correlationId,
      });
    }
    if (result.status === "in_use") {
      return apiError({ code: "conflict", message: result.reason, status: 409, correlationId });
    }

    return NextResponse.json(
      { status: "ok", customerId: result.customerId, gstin: result.gstin, correlationId },
      { status: 200 },
    );
  } catch (err) {
    logError("address: set gstin failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Saving the GSTIN is temporarily unavailable.");
  }
}
