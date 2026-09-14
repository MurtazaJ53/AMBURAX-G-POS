import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { updateCustomerAddress, deactivateAddress } from "@/server/address/addressService";

export const runtime = "nodejs";

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
});

/** Edit an address in place. Orders will snapshot, so this cannot rewrite a past destination. */
export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; addressId: string }> },
) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  const { addressId } = await ctx.params;

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

    const result = await updateCustomerAddress({
      tenantId: resolved.context.tenantId,
      actorUserId: resolved.context.userId,
      addressId,
      address: parsed.data,
      correlationId,
    });

    if (result.status === "not_found") {
      return apiError({
        code: "not_found",
        message: "That address could not be found.",
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
      { status: "ok", address: result.address, correlationId },
      { status: 200 },
    );
  } catch (err) {
    logError("address: update failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Updating the address is temporarily unavailable.");
  }
}

/** Retire an address. Deactivation, not deletion — see docs/architecture/ADDRESS.md. */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; addressId: string }> },
) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  const { addressId } = await ctx.params;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const result = await deactivateAddress({
      tenantId: resolved.context.tenantId,
      actorUserId: resolved.context.userId,
      addressId,
      correlationId,
    });

    if (result.status === "not_found") {
      return apiError({
        code: "not_found",
        message: "That address could not be found.",
        status: 404,
        correlationId,
      });
    }
    if (result.status === "in_use") {
      return apiError({ code: "conflict", message: result.reason, status: 409, correlationId });
    }
    if (result.status === "validation_error") {
      return apiError({
        code: "validation_error",
        message: result.reason,
        status: 400,
        correlationId,
      });
    }

    return NextResponse.json(
      { status: "ok", addressId: result.addressId, correlationId },
      { status: 200 },
    );
  } catch (err) {
    logError("address: deactivate failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Retiring the address is temporarily unavailable.");
  }
}
