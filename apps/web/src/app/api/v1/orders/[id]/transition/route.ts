import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { OrderStatus } from "@prisma/client";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { transitionOrder } from "@/server/orders/orderService";
import { orderErrorResponse } from "../../route";

export const runtime = "nodejs";

/**
 * Move an order to its next state.
 *
 * `to` names a destination, and the service decides whether that destination is reachable and
 * what work it involves — re-resolving prices for CONFIRMED, snapshotting addresses, recording a
 * cancellation reason. Nothing here writes a status column directly, so there is no route by
 * which a caller can assign an order whatever status it likes.
 *
 * RESERVED is accepted by the schema deliberately, so that asking for it produces an honest
 * explanation (nothing in this system reserves stock) rather than a validation error that reads
 * like a typo.
 */
const transitionSchema = z.object({
  to: z.nativeEnum(OrderStatus),
  reason: z.string().trim().min(1).max(500).optional(),
  expectedVersion: z.number().int().positive().optional(),
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

  const parsed = transitionSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "validation_error",
      message: "Name a valid order status to move to.",
      status: 400,
      correlationId,
    });
  }

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const result = await transitionOrder({
      actor: {
        tenantId: resolved.context.tenantId,
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
        membershipRole: resolved.context.membershipRole,
      },
      orderId: id,
      to: parsed.data.to,
      reason: parsed.data.reason,
      expectedVersion: parsed.data.expectedVersion,
      correlationId,
    });

    if (result.status !== "ok") return orderErrorResponse(result, correlationId);
    return NextResponse.json({ status: "ok", order: result.order, correlationId }, { status: 200 });
  } catch (err) {
    logError("orders: transition failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Changing an order is temporarily unavailable.");
  }
}
