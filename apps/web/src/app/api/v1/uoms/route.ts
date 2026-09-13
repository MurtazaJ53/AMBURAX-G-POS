import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { createUom, listUoms } from "@/server/uom/uomService";

export const runtime = "nodejs";

/** The tenant's unit catalogue. Tenant comes from the session, never from the request. */
export async function GET(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const uoms = await listUoms(resolved.context.tenantId);
    return NextResponse.json({ status: "ok", uoms, correlationId }, { status: 200 });
  } catch (err) {
    logError("uom: list failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Units are temporarily unavailable.");
  }
}

const createSchema = z.object({
  code: z.string().trim().min(1).max(16),
  name: z.string().trim().min(2).max(100),
  // Accepted so the catalogue can describe METRE or KG honestly. It does not enable fractional
  // quantities: conversion refuses to compute with such a unit, and a product cannot be based on
  // one. See docs/architecture/UOM.md.
  decimalPlaces: z.number().int().min(0).max(3).optional(),
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

    const result = await createUom({
      actor: {
        tenantId: resolved.context.tenantId,
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
        membershipRole: resolved.context.membershipRole,
      },
      code: parsed.data.code,
      name: parsed.data.name,
      decimalPlaces: parsed.data.decimalPlaces,
      correlationId,
    });

    if (result.status === "forbidden") {
      return forbidden(correlationId, "You do not have permission to manage units.");
    }
    if (result.status === "validation_error") {
      return apiError({
        code: "validation_error",
        message: result.reason,
        status: 400,
        correlationId,
      });
    }
    if (result.status === "not_found" || result.status === "conflict") {
      return apiError({
        code: result.status === "conflict" ? "conflict" : "not_found",
        message: result.status === "conflict" ? result.reason : "Not found.",
        status: result.status === "conflict" ? 409 : 404,
        correlationId,
      });
    }

    return NextResponse.json(
      { status: "ok", uom: result.uom, existing: result.existing, correlationId },
      { status: result.existing ? 200 : 201 },
    );
  } catch (err) {
    logError("uom: create failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Creating a unit is temporarily unavailable.");
  }
}
