import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { resolvePrice } from "@/server/pricing/pricingService";

export const runtime = "nodejs";

/**
 * Ask what something costs.
 *
 * Server-authoritative: the caller sends ids and a quantity, never a price. POST because it takes
 * a body, not because it changes anything — nothing is written here.
 *
 * The store defaults to the session's store; a caller may name another of the tenant's stores.
 */
const resolveSchema = z.object({
  variantId: z.string().min(1),
  uomId: z.string().min(1),
  quantity: z.number().int().positive(),
  customerId: z.string().min(1).nullable().optional(),
  storeId: z.string().min(1).optional(),
  at: z.string().datetime().optional(),
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

  const parsed = resolveSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Check the request and try again.",
      status: 400,
      correlationId,
    });
  }

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const result = await resolvePrice({
      tenantId: resolved.context.tenantId,
      storeId: parsed.data.storeId ?? resolved.context.storeId,
      variantId: parsed.data.variantId,
      uomId: parsed.data.uomId,
      quantity: parsed.data.quantity,
      customerId: parsed.data.customerId ?? null,
      at: parsed.data.at ? new Date(parsed.data.at) : undefined,
    });

    switch (result.status) {
      case "ok":
        return NextResponse.json(
          {
            status: "ok",
            unitPriceMinor: result.unitPriceMinor,
            currency: result.currency,
            source: result.source,
            priceListId: result.priceListId,
            minQuantity: result.minQuantity,
            correlationId,
          },
          { status: 200 },
        );
      case "not_found":
        return apiError({
          code: "not_found",
          message: "That store, product, unit or customer could not be found.",
          status: 404,
          correlationId,
        });
      case "currency_mismatch":
        // Refused rather than skipped: a silently ignored price list is worse than an error.
        return apiError({
          code: "currency_mismatch",
          message: `That price list is in ${result.listCurrency} and this store sells in ${result.storeCurrency}. Prices are never converted.`,
          status: 422,
          correlationId,
        });
      case "no_price":
        return apiError({
          code: "no_price",
          message: "No price is configured for that product in that unit.",
          status: 422,
          correlationId,
        });
      case "validation_error":
        return apiError({
          code: "validation_error",
          message: result.reason,
          status: 400,
          correlationId,
        });
      default:
        return apiError({
          code: "conflict",
          message: "That request could not be completed.",
          status: 409,
          correlationId,
        });
    }
  } catch (err) {
    logError("pricing: resolve failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Pricing is temporarily unavailable.");
  }
}
