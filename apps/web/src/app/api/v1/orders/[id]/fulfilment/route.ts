import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { recordFulfilment } from "@/server/orders/orderService";
import { orderErrorResponse } from "../../route";

export const runtime = "nodejs";

/**
 * Record how much of an order has actually been met.
 *
 * **Quantity accounting, not a fulfilment engine.** There is no shipment here, no picking list,
 * no courier, no tracking number, and no stock movement — this endpoint moves integers on order
 * lines and nothing else. It exists so PARTIALLY_FULFILLED and FULFILLED are derived from
 * recorded quantities rather than set by a caller naming a status.
 *
 * The resulting status is computed from the lines. There is no status field in this body.
 */
const fulfilSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
  lines: z
    .array(
      z.object({
        orderItemId: z.string().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(200),
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

  const parsed = fulfilSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Check the details and try again.",
      status: 400,
      correlationId,
    });
  }

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const result = await recordFulfilment({
      actor: {
        tenantId: resolved.context.tenantId,
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
        membershipRole: resolved.context.membershipRole,
      },
      orderId: id,
      lines: parsed.data.lines,
      expectedVersion: parsed.data.expectedVersion,
      correlationId,
    });

    if (result.status !== "ok") return orderErrorResponse(result, correlationId);
    return NextResponse.json({ status: "ok", order: result.order, correlationId }, { status: 200 });
  } catch (err) {
    logError("orders: fulfilment failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Recording fulfilment is temporarily unavailable.");
  }
}
