import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { setPriceListItem, listPriceListItems } from "@/server/pricing/pricingService";

export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  const { id } = await ctx.params;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const result = await listPriceListItems({
      tenantId: resolved.context.tenantId,
      priceListId: id,
    });
    if (result.status !== "ok") {
      return apiError({
        code: "not_found",
        message: "That price list could not be found.",
        status: 404,
        correlationId,
      });
    }

    return NextResponse.json({ status: "ok", items: result.items, correlationId }, { status: 200 });
  } catch (err) {
    logError("pricing: list items failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Prices are temporarily unavailable.");
  }
}

/**
 * Set the price for one quantity break.
 *
 * `minQuantity` defaults to 1 — the base break. A second call with the same variant, unit and
 * break replaces the price; the database's unique key guarantees there can only be one.
 */
const itemSchema = z.object({
  variantId: z.string().min(1),
  uomId: z.string().min(1),
  minQuantity: z.number().int().positive().optional(),
  // Zero is deliberately allowed: an explicitly free line, not a promotion mechanism.
  unitPriceMinor: z.number().int().min(0),
  validFrom: z.string().datetime().nullable().optional(),
  validTo: z.string().datetime().nullable().optional(),
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

  const parsed = itemSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Check the price and try again.",
      status: 400,
      correlationId,
    });
  }

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const result = await setPriceListItem({
      actor: {
        tenantId: resolved.context.tenantId,
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
        membershipRole: resolved.context.membershipRole,
      },
      priceListId: id,
      variantId: parsed.data.variantId,
      uomId: parsed.data.uomId,
      minQuantity: parsed.data.minQuantity,
      unitPriceMinor: parsed.data.unitPriceMinor,
      validFrom: parsed.data.validFrom ? new Date(parsed.data.validFrom) : null,
      validTo: parsed.data.validTo ? new Date(parsed.data.validTo) : null,
      correlationId,
    });

    if (result.status === "forbidden") {
      return forbidden(correlationId, "You do not have permission to manage pricing.");
    }
    if (result.status === "not_found") {
      // A foreign-tenant list, variant or unit answers exactly like one that does not exist.
      return apiError({
        code: "not_found",
        message: "That price list, product or unit could not be found.",
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
      { status: "ok", item: result.item, replaced: result.replaced, correlationId },
      { status: result.replaced ? 200 : 201 },
    );
  } catch (err) {
    logError("pricing: set item failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Saving the price is temporarily unavailable.");
  }
}
