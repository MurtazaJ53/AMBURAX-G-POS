import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CustomerType } from "@prisma/client";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import {
  getCommercialProfile,
  setCommercialProfile,
  type CommercialProfileFailure,
} from "@/server/wholesale/customerCommercial";

export const runtime = "nodejs";

/**
 * Map a commercial-profile refusal to a response.
 *
 * A disabled WHOLESALE capability answers 404, per the P1-7 freeze: whether a tenant has a
 * module is not something their API surface volunteers. The service keeps the distinction
 * internally for logs; the boundary flattens it.
 */
function commercialErrorResponse(failure: CommercialProfileFailure, correlationId: string) {
  switch (failure.status) {
    case "forbidden":
      return forbidden(correlationId, "Only the business owner can set commercial terms.");
    case "not_found":
      return apiError({ code: "not_found", message: "Not found.", status: 404, correlationId });
    case "validation_error":
      return apiError({
        code: "validation_error",
        message: failure.reason,
        status: 400,
        correlationId,
      });
    case "capability_disabled":
      return apiError({ code: "not_found", message: "Not found.", status: 404, correlationId });
  }
}

/** The terms agreed with one buyer. Tenant comes from the session; there is no tenant parameter. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  const { id } = await ctx.params;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const result = await getCommercialProfile({
      actor: {
        tenantId: resolved.context.tenantId,
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
        membershipRole: resolved.context.membershipRole,
      },
      customerId: id,
    });

    if (result.status !== "ok") return commercialErrorResponse(result, correlationId);
    return NextResponse.json(
      { status: "ok", profile: result.profile, correlationId },
      { status: 200 },
    );
  } catch (err) {
    logError("wholesale: read commercial profile failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Commercial terms are temporarily unavailable.");
  }
}

/**
 * Set the terms agreed with a buyer.
 *
 * Every field is optional: omitting one leaves it untouched, while sending `null` clears it.
 * Note what the body cannot carry — no outstanding balance, no available credit, no ageing.
 * Those are ERPNext's and no field exists here to accept them.
 */
const putSchema = z.object({
  customerType: z.nativeEnum(CustomerType).optional(),
  paymentTermsDays: z.number().int().min(0).nullable().optional(),
  creditLimitMinor: z.number().int().min(0).nullable().optional(),
});

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

  const parsed = putSchema.safeParse(body);
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

    const result = await setCommercialProfile({
      actor: {
        tenantId: resolved.context.tenantId,
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
        membershipRole: resolved.context.membershipRole,
      },
      customerId: id,
      customerType: parsed.data.customerType,
      paymentTermsDays: parsed.data.paymentTermsDays,
      creditLimitMinor: parsed.data.creditLimitMinor,
      correlationId,
    });

    if (result.status !== "ok") return commercialErrorResponse(result, correlationId);
    return NextResponse.json(
      { status: "ok", profile: result.profile, correlationId },
      { status: 200 },
    );
  } catch (err) {
    logError("wholesale: set commercial profile failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Setting commercial terms is temporarily unavailable.");
  }
}
