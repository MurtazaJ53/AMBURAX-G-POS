import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { setDefaultAddress } from "@/server/address/addressService";

export const runtime = "nodejs";

const defaultSchema = z.object({
  addressId: z.string().min(1),
  purpose: z.enum(["BILLING", "SHIPPING"]),
});

/**
 * Choose a customer's default billing or shipping address.
 *
 * One column, one value: two conflicting defaults is not a state the database can represent, so
 * this is a single UPDATE with no reconciliation step.
 */
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

  const parsed = defaultSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Choose an address.",
      status: 400,
      correlationId,
    });
  }

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const result = await setDefaultAddress({
      tenantId: resolved.context.tenantId,
      actorUserId: resolved.context.userId,
      customerId: id,
      addressId: parsed.data.addressId,
      purpose: parsed.data.purpose,
      correlationId,
    });

    if (result.status === "not_found") {
      return apiError({
        code: "not_found",
        message:
          result.what === "customer"
            ? "That customer could not be found."
            : "That address could not be found.",
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
      {
        status: "ok",
        customerId: result.customerId,
        purpose: result.purpose,
        addressId: result.addressId,
        correlationId,
      },
      { status: 200 },
    );
  } catch (err) {
    logError("address: set default failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Setting the default is temporarily unavailable.");
  }
}
