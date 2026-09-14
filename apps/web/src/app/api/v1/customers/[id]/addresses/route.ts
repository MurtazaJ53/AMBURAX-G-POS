import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { createCustomerAddress, listCustomerAddresses } from "@/server/address/addressService";

export const runtime = "nodejs";

/** A customer's addresses. The tenant comes from the session; the customer id from the path. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  const { id } = await ctx.params;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const result = await listCustomerAddresses({
      tenantId: resolved.context.tenantId,
      customerId: id,
      includeInactive: req.nextUrl.searchParams.get("includeInactive") === "true",
    });

    if (result.status !== "ok") {
      // Another tenant's customer answers exactly like one that does not exist.
      return apiError({
        code: "not_found",
        message: "That customer could not be found.",
        status: 404,
        correlationId,
      });
    }

    return NextResponse.json(
      { status: "ok", addresses: result.addresses, correlationId },
      { status: 200 },
    );
  } catch (err) {
    logError("address: list failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Addresses are temporarily unavailable.");
  }
}

const addressSchema = z.object({
  line1: z.string().min(1),
  line2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  postalCode: z.string().min(1),
  country: z.string().min(2).max(2),
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),
  type: z.enum(["BILLING", "SHIPPING", "BOTH"]),
  makeDefault: z.boolean().optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

  const parsed = addressSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Check the address and try again.",
      status: 400,
      correlationId,
    });
  }

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const { makeDefault, ...address } = parsed.data;
    const result = await createCustomerAddress({
      tenantId: resolved.context.tenantId,
      actorUserId: resolved.context.userId,
      customerId: id,
      address,
      makeDefault,
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

    return NextResponse.json({ status: "ok", address: result.address, correlationId }, { status: 201 });
  } catch (err) {
    logError("address: create failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Saving the address is temporarily unavailable.");
  }
}
