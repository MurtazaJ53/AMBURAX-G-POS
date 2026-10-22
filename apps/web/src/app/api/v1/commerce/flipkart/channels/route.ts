import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, forbidden, noStore, unauthorized } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import {
  getFlipkartChannels,
  upsertFlipkartAccount,
  canManageCommerce,
} from "@/server/commerce/flipkart";

export const runtime = "nodejs";

/**
 * GET /api/v1/commerce/flipkart/channels
 * Returns all connected Flipkart accounts with stats
 */
export async function GET(req: NextRequest) {
  const correlationId = randomUUID();
  try {
    const resolved = await resolvePosContext(req.cookies.get(env.SESSION_COOKIE_NAME)?.value);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const channels = await getFlipkartChannels(resolved.context.tenantId);
    return NextResponse.json({ channels });
  } catch (err) {
    logError("api:commerce:flipkart:channels:get", err);
    return apiError({ code: "server_error", message: "Failed to load channels", status: 500, correlationId });
  }
}

/**
 * POST /api/v1/commerce/flipkart/channels
 * Connects or updates a Flipkart Marketplace Seller account
 */
export async function POST(req: NextRequest) {
  const correlationId = randomUUID();
  try {
    const resolved = await resolvePosContext(req.cookies.get(env.SESSION_COOKIE_NAME)?.value);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    if (!canManageCommerce({ tenantRole: resolved.context.tenantRole, membershipRole: resolved.context.membershipRole })) {
      return forbidden(correlationId, "Only owners or store managers can connect commerce channels.");
    }

    const body = await req.json();
    const result = await upsertFlipkartAccount({
      tenantId: resolved.context.tenantId,
      actorUserId: resolved.context.userId,
      input: {
        name: body.name || "",
        sellerId: body.sellerId || "",
        appId: body.appId || "",
        appSecret: body.appSecret || "",
        storeId: body.storeId || resolved.context.storeId,
      },
    });

    if (result.status === "error") {
      return apiError({ code: "bad_request", message: result.reason, status: 400, correlationId });
    }

    return NextResponse.json({ ok: true, channel: result.channel });
  } catch (err) {
    logError("api:commerce:flipkart:channels:post", err);
    return apiError({ code: "server_error", message: "Failed to connect Flipkart account", status: 500, correlationId });
  }
}
