import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { setTenantDefaultPriceList } from "@/server/pricing/pricingService";

export const runtime = "nodejs";

function actorFrom(context: {
  tenantId: string;
  userId: string;
  tenantRole: "OWNER" | "STAFF";
  membershipRole: string | null;
}) {
  return {
    tenantId: context.tenantId,
    userId: context.userId,
    tenantRole: context.tenantRole,
    membershipRole: context.membershipRole,
  };
}

/**
 * Make this price list the tenant's default — the last list tried before the variant's own price.
 *
 * The list is the path, not the body: `PUT .../price-lists/{id}/default` says which one, and
 * `DELETE` on the same path clears it. A pointer on the tenant means there can only ever be one,
 * so there is nothing to reconcile and no previous default to clear first.
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  const { id } = await ctx.params;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const result = await setTenantDefaultPriceList({
      actor: actorFrom(resolved.context),
      priceListId: id,
      correlationId,
    });

    if (result.status === "forbidden") {
      return forbidden(correlationId, "You do not have permission to manage pricing.");
    }
    if (result.status === "not_found") {
      // A foreign-tenant list answers exactly like one that does not exist.
      return apiError({
        code: "not_found",
        message: "That price list could not be found.",
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
    logError("pricing: set tenant default failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Setting the default is temporarily unavailable.");
  }
}

/** Clear the tenant default. Resolution then falls through to the variant's base price. */
export async function DELETE(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const result = await setTenantDefaultPriceList({
      actor: actorFrom(resolved.context),
      priceListId: null,
      correlationId,
    });

    if (result.status === "forbidden") {
      return forbidden(correlationId, "You do not have permission to manage pricing.");
    }
    if (result.status !== "ok") {
      return apiError({
        code: "not_found",
        message: "That price list could not be found.",
        status: 404,
        correlationId,
      });
    }

    return NextResponse.json({ status: "ok", priceListId: null, correlationId }, { status: 200 });
  } catch (err) {
    logError("pricing: clear tenant default failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Clearing the default is temporarily unavailable.");
  }
}
