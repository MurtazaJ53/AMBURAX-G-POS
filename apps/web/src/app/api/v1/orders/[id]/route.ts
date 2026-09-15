import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { getOrder, updateDraftOrder } from "@/server/orders/orderService";
import { orderErrorResponse } from "../route";

export const runtime = "nodejs";

/** One order. Another tenant's order answers exactly like one that does not exist. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  const { id } = await ctx.params;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const result = await getOrder({
      actor: {
        tenantId: resolved.context.tenantId,
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
        membershipRole: resolved.context.membershipRole,
      },
      orderId: id,
    });

    if (result.status !== "ok") return orderErrorResponse(result, correlationId);
    return NextResponse.json({ status: "ok", order: result.order, correlationId }, { status: 200 });
  } catch (err) {
    logError("orders: get failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Orders are temporarily unavailable.");
  }
}

/**
 * Replace a draft's lines.
 *
 * Only lines and customer, and only while the order is a DRAFT. There is no field here for a
 * status, a price, a total, an order number or a store — none of those is something a caller may
 * change at any point in an order's life.
 *
 * `expectedVersion` is optional but strongly advised: sending it turns a lost race into a
 * refusal instead of a silent overwrite of someone else's edit.
 */
const updateSchema = z.object({
  customerId: z.string().min(1).nullable().optional(),
  expectedVersion: z.number().int().positive().optional(),
  lines: z
    .array(
      z.object({
        variantId: z.string().min(1),
        uomId: z.string().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(200),
});

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

  const parsed = updateSchema.safeParse(body);
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

    const result = await updateDraftOrder({
      actor: {
        tenantId: resolved.context.tenantId,
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
        membershipRole: resolved.context.membershipRole,
      },
      orderId: id,
      lines: parsed.data.lines,
      customerId: parsed.data.customerId,
      expectedVersion: parsed.data.expectedVersion,
      correlationId,
    });

    if (result.status !== "ok") return orderErrorResponse(result, correlationId);
    return NextResponse.json({ status: "ok", order: result.order, correlationId }, { status: 200 });
  } catch (err) {
    logError("orders: update failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Updating an order is temporarily unavailable.");
  }
}
