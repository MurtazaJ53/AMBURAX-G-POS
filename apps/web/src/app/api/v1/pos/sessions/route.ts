import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import {
  currentSessionForDevice,
  openPosSession,
  type PosSessionFailure,
} from "@/server/pos/posSessionService";

export const runtime = "nodejs";

/**
 * Map a shift refusal to a response. Shared with the [id] route so one refusal cannot mean
 * different things at different endpoints.
 *
 * A disabled RETAIL capability answers 404, per the P1-7 freeze: whether a tenant has a module
 * is not something their API surface volunteers.
 */
export function posSessionErrorResponse(failure: PosSessionFailure, correlationId: string) {
  switch (failure.status) {
    case "forbidden":
      return forbidden(correlationId, "You do not have permission to work this terminal.");
    case "not_found":
      return apiError({ code: "not_found", message: "Not found.", status: 404, correlationId });
    case "validation_error":
      return apiError({
        code: "validation_error",
        message: failure.reason,
        status: 400,
        correlationId,
      });
    case "conflict":
      return apiError({ code: "conflict", message: failure.reason, status: 409, correlationId });
    case "device_unavailable":
      return apiError({
        code: "device_unavailable",
        message: failure.reason,
        status: 409,
        correlationId,
      });
    case "capability_disabled":
      return apiError({ code: "not_found", message: "Not found.", status: 404, correlationId });
  }
}

/** The shift currently open on a terminal, if any. */
export async function GET(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  const posDeviceId = req.nextUrl.searchParams.get("posDeviceId");

  if (!posDeviceId) {
    return apiError({
      code: "validation_error",
      message: "Name the terminal.",
      status: 400,
      correlationId,
    });
  }

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const session = await currentSessionForDevice({
      tenantId: resolved.context.tenantId,
      posDeviceId,
    });
    return NextResponse.json({ status: "ok", session, correlationId }, { status: 200 });
  } catch (err) {
    logError("pos session: read failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Terminals are temporarily unavailable.");
  }
}

const openSchema = z.object({ posDeviceId: z.string().min(1) });

/** Open a shift, or resume the caller's own shift already open on that terminal. */
export async function POST(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

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

  const parsed = openSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "validation_error",
      message: "Name the terminal.",
      status: 400,
      correlationId,
    });
  }

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const result = await openPosSession({
      actor: {
        tenantId: resolved.context.tenantId,
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
        membershipRole: resolved.context.membershipRole,
      },
      posDeviceId: parsed.data.posDeviceId,
      correlationId,
    });

    if (result.status !== "ok") return posSessionErrorResponse(result, correlationId);

    // A resumed shift is not a new one, and the status code says so.
    return NextResponse.json(
      { status: "ok", session: result.session, resumed: result.resumed, correlationId },
      { status: result.resumed ? 200 : 201 },
    );
  } catch (err) {
    logError("pos session: open failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Opening a shift is temporarily unavailable.");
  }
}
