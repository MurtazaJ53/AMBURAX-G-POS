import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { assignCustomerPriceList } from "@/server/pricing/pricingService";

export const runtime = "nodejs";

/** `null` clears the assignment, which falls the resolution chain through to the next step. */
const assignSchema = z.object({ priceListId: z.string().min(1).nullable() });

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

  const parsed = assignSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "validation_error",
      message: "Send a price list id, or null to clear it.",
      status: 400,
      correlationId,
    });
  }

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const result = await assignCustomerPriceList({
      actor: {
        tenantId: resolved.context.tenantId,
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
        membershipRole: resolved.context.membershipRole,
      },
      customerId: id,
      priceListId: parsed.data.priceListId,
      correlationId,
    });

    if (result.status === "forbidden") {
      return forbidden(correlationId, "You do not have permission to manage pricing.");
    }
    if (result.status === "not_found") {
      // A foreign-tenant resource answers exactly like one that does not exist.
      return apiError({
        code: "not_found",
        message: "That customer or price list could not be found.",
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
      { status: "ok", priceListId: result.priceListId, correlationId },
      { status: 200 },
    );
  } catch (err) {
    logError("pricing: assign customer list failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Assigning the price list is temporarily unavailable.");
  }
}
