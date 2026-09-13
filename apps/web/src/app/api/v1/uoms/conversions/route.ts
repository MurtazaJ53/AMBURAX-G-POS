import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { createUomConversion, listUomConversions } from "@/server/uom/uomService";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const conversions = await listUomConversions(resolved.context.tenantId);
    return NextResponse.json({ status: "ok", conversions, correlationId }, { status: 200 });
  } catch (err) {
    logError("uom: conversion list failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Conversions are temporarily unavailable.");
  }
}

/** "One fromUom contains `factor` toUom" — the only direction that is ever stored. */
const createSchema = z.object({
  fromUomId: z.string().min(1),
  toUomId: z.string().min(1),
  factor: z.number().int(),
});

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

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Check the details and try again.",
      status: 400,
      correlationId,
    });
  }

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const result = await createUomConversion({
      actor: {
        tenantId: resolved.context.tenantId,
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
        membershipRole: resolved.context.membershipRole,
      },
      fromUomId: parsed.data.fromUomId,
      toUomId: parsed.data.toUomId,
      factor: parsed.data.factor,
      correlationId,
    });

    if (result.status === "forbidden") {
      return forbidden(correlationId, "You do not have permission to manage units.");
    }
    if (result.status === "not_found") {
      // A unit belonging to another tenant answers exactly like one that does not exist.
      return apiError({
        code: "not_found",
        message: "That unit could not be found.",
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
    if (result.status === "conflict") {
      return apiError({ code: "conflict", message: result.reason, status: 409, correlationId });
    }

    return NextResponse.json(
      { status: "ok", conversion: result.conversion, existing: result.existing, correlationId },
      { status: result.existing ? 200 : 201 },
    );
  } catch (err) {
    logError("uom: conversion create failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Creating a conversion is temporarily unavailable.");
  }
}
