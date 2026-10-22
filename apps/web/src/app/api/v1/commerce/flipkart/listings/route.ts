import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, forbidden, noStore, unauthorized } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import {
  getFlipkartListings,
  mapVariantToFlipkart,
  canManageCommerce,
} from "@/server/commerce/flipkart";

export const runtime = "nodejs";

/**
 * GET /api/v1/commerce/flipkart/listings?channelId=...
 * Fetch mapped listings for a Flipkart channel
 */
export async function GET(req: NextRequest) {
  const correlationId = randomUUID();
  try {
    const resolved = await resolvePosContext(req.cookies.get(env.SESSION_COOKIE_NAME)?.value);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const channelId = req.nextUrl.searchParams.get("channelId");
    if (!channelId) {
      return apiError({ code: "bad_request", message: "channelId is required", status: 400, correlationId });
    }

    const listings = await getFlipkartListings({
      tenantId: resolved.context.tenantId,
      channelId,
    });

    return NextResponse.json({ listings });
  } catch (err) {
    logError("api:commerce:flipkart:listings:get", err);
    return apiError({ code: "server_error", message: "Failed to load listings", status: 500, correlationId });
  }
}

/**
 * POST /api/v1/commerce/flipkart/listings
 * Map an internal ProductVariant to a Flipkart FSN / SKU
 */
export async function POST(req: NextRequest) {
  const correlationId = randomUUID();
  try {
    const resolved = await resolvePosContext(req.cookies.get(env.SESSION_COOKIE_NAME)?.value);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    if (!canManageCommerce({ tenantRole: resolved.context.tenantRole, membershipRole: resolved.context.membershipRole })) {
      return forbidden(correlationId, "Only owners or store managers can map catalog items.");
    }

    const body = await req.json();
    if (!body.channelId || !body.variantId || !body.sellerSku) {
      return apiError({
        code: "bad_request",
        message: "channelId, variantId, and sellerSku are required",
        status: 400,
        correlationId,
      });
    }

    const result = await mapVariantToFlipkart({
      tenantId: resolved.context.tenantId,
      actorUserId: resolved.context.userId,
      input: {
        channelId: body.channelId,
        variantId: body.variantId,
        sellerSku: body.sellerSku,
        externalListingId: body.externalListingId || null,
        channelPriceMinor: body.channelPriceMinor ? Math.round(Number(body.channelPriceMinor)) : null,
        stockAllocation: body.stockAllocation ? Number(body.stockAllocation) : 0,
      },
    });

    if (result.status === "error") {
      return apiError({ code: "bad_request", message: result.reason, status: 400, correlationId });
    }

    return NextResponse.json({ ok: true, listing: result.listing });
  } catch (err) {
    logError("api:commerce:flipkart:listings:post", err);
    return apiError({ code: "server_error", message: "Failed to map listing", status: 500, correlationId });
  }
}
