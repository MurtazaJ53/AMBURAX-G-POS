import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { createPriceList, listPriceLists } from "@/server/pricing/pricingService";

export const runtime = "nodejs";

/** The tenant's price lists. Tenant comes from the session, never from the request. */
export async function GET(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const priceLists = await listPriceLists(resolved.context.tenantId);
    return NextResponse.json({ status: "ok", priceLists, correlationId }, { status: 200 });
  } catch (err) {
    logError("pricing: list failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Price lists are temporarily unavailable.");
  }
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(100),
  currency: z.string().trim().min(3).max(3),
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

    const result = await createPriceList({
      actor: {
        tenantId: resolved.context.tenantId,
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
        membershipRole: resolved.context.membershipRole,
      },
      name: parsed.data.name,
      currency: parsed.data.currency,
      correlationId,
    });

    if (result.status === "forbidden") {
      return forbidden(correlationId, "You do not have permission to manage pricing.");
    }
    if (result.status === "validation_error") {
      return apiError({
        code: "validation_error",
        message: result.reason,
        status: 400,
        correlationId,
      });
    }
    if (result.status === "not_found") {
      return apiError({ code: "not_found", message: "Not found.", status: 404, correlationId });
    }
    if (result.status === "conflict") {
      return apiError({ code: "conflict", message: result.reason, status: 409, correlationId });
    }

    return NextResponse.json(
      { status: "ok", priceList: result.priceList, existing: result.existing, correlationId },
      { status: result.existing ? 200 : 201 },
    );
  } catch (err) {
    logError("pricing: create list failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Creating a price list is temporarily unavailable.");
  }
}
