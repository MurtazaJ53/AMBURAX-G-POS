import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, forbidden, noStore, unauthorized } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import {
  syncFlipkartInventory,
  pullFlipkartOrders,
  getCommerceSyncLogs,
  canManageCommerce,
} from "@/server/commerce/flipkart";

export const runtime = "nodejs";

/**
 * GET /api/v1/commerce/flipkart/sync?channelId=...
 * Get sync history audit logs for this channel
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

    const logs = await getCommerceSyncLogs({
      tenantId: resolved.context.tenantId,
      channelId,
    });

    return NextResponse.json({ logs });
  } catch (err) {
    logError("api:commerce:flipkart:sync:get", err);
    return apiError({ code: "server_error", message: "Failed to load sync logs", status: 500, correlationId });
  }
}

/**
 * POST /api/v1/commerce/flipkart/sync
 * Trigger manual inventory push or orders pull
 * Body: { channelId: string, action: "sync_inventory" | "pull_orders" }
 */
export async function POST(req: NextRequest) {
  const correlationId = randomUUID();
  try {
    const resolved = await resolvePosContext(req.cookies.get(env.SESSION_COOKIE_NAME)?.value);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    if (!canManageCommerce({ tenantRole: resolved.context.tenantRole, membershipRole: resolved.context.membershipRole })) {
      return forbidden(correlationId, "Only owners or store managers can trigger channel synchronization.");
    }

    const body = await req.json();
    const { channelId, action } = body;

    if (!channelId || !action) {
      return apiError({
        code: "bad_request",
        message: "channelId and action ('sync_inventory' | 'pull_orders') are required",
        status: 400,
        correlationId,
      });
    }

    if (action === "sync_inventory") {
      const res = await syncFlipkartInventory({
        tenantId: resolved.context.tenantId,
        channelId,
      });
      if (res.status === "error") {
        return apiError({ code: "bad_request", message: res.reason, status: 400, correlationId });
      }
      return NextResponse.json({ ok: true, message: `Pushed inventory for ${res.count} listings.` });
    }

    if (action === "pull_orders") {
      const res = await pullFlipkartOrders({
        tenantId: resolved.context.tenantId,
        channelId,
        actorUserId: resolved.context.userId,
      });
      if (res.status === "error") {
        return apiError({ code: "bad_request", message: res.reason, status: 400, correlationId });
      }
      return NextResponse.json({ ok: true, message: `Ingested ${res.ordersCount} new Flipkart order(s).` });
    }

    return apiError({ code: "bad_request", message: "Invalid action", status: 400, correlationId });
  } catch (err) {
    logError("api:commerce:flipkart:sync:post", err);
    return apiError({ code: "server_error", message: "Sync operation failed", status: 500, correlationId });
  }
}
