import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { OrderStatus } from "@prisma/client";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { createOrder, listOrders, type OrderFailure } from "@/server/orders/orderService";

export const runtime = "nodejs";

/**
 * Map a service refusal to a response.
 *
 * Shared by every order route so one refusal cannot mean 404 here and 409 there. Note what is
 * absent: no branch leaks whether a resource belongs to another tenant — every foreign id
 * arrives already flattened to `not_found` by the service.
 */
export function orderErrorResponse(failure: OrderFailure, correlationId: string) {
  switch (failure.status) {
    case "forbidden":
      return forbidden(correlationId, "You do not have permission to manage orders.");

    case "not_found":
      return apiError({ code: "not_found", message: "Not found.", status: 404, correlationId });

    case "validation_error":
      return apiError({
        code: "validation_error",
        message: failure.reason,
        status: 400,
        correlationId,
      });

    case "conflict":
      return apiError({ code: "conflict", message: failure.reason, status: 409, correlationId });

    case "no_price":
      return apiError({
        code: "no_price",
        message: "No price is configured for one of these items.",
        status: 409,
        correlationId,
      });

    case "currency_mismatch":
      return apiError({
        code: "currency_mismatch",
        message: failure.reason,
        status: 409,
        correlationId,
      });

    case "invalid_transition":
      return apiError({
        code: "invalid_transition",
        message: `An order that is ${failure.from} cannot become ${failure.to}.`,
        status: 409,
        correlationId,
      });

    // Deliberately explicit rather than a generic refusal. The caller asked for something the
    // system cannot honestly do yet, and saying so is more useful than pretending the order is
    // merely in the wrong state.
    case "reservation_unavailable":
      return apiError({
        code: "reservation_unavailable",
        message:
          "Stock reservation is not available. Nothing in this system reserves stock yet, so an order cannot be marked reserved.",
        status: 409,
        correlationId,
      });
  }
}

/** The tenant's orders. Tenant comes from the session; there is no tenant parameter. */
export async function GET(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  const statusParam = req.nextUrl.searchParams.get("status");
  const status =
    statusParam && (Object.values(OrderStatus) as string[]).includes(statusParam)
      ? (statusParam as OrderStatus)
      : undefined;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const orders = await listOrders({ tenantId: resolved.context.tenantId, status });
    return NextResponse.json({ status: "ok", orders, correlationId }, { status: 200 });
  } catch (err) {
    logError("orders: list failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Orders are temporarily unavailable.");
  }
}

/**
 * Create a draft order.
 *
 * Note what the body cannot carry: no price, no subtotal, no total, no status. Prices are
 * resolved server-side by the P1-8E pricing service and the status starts at DRAFT, so a client
 * can neither name its own price nor start an order half-way through its life.
 */
const createSchema = z.object({
  storeId: z.string().min(1),
  customerId: z.string().min(1).nullable().optional(),
  idempotencyKey: z.string().min(8).max(200),
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

  const parsed = createSchema.safeParse(body);
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

    const result = await createOrder({
      actor: {
        tenantId: resolved.context.tenantId,
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
        membershipRole: resolved.context.membershipRole,
      },
      storeId: parsed.data.storeId,
      customerId: parsed.data.customerId ?? null,
      lines: parsed.data.lines,
      idempotencyKey: parsed.data.idempotencyKey,
      correlationId,
    });

    if (result.status !== "ok") return orderErrorResponse(result, correlationId);

    // A replayed create returns the original order with 200 rather than 201. The operator sees
    // success because the order really exists; the status code is what tells a client it was not
    // created twice.
    return NextResponse.json(
      { status: "ok", order: result.order, duplicate: result.duplicate, correlationId },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (err) {
    logError("orders: create failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Creating an order is temporarily unavailable.");
  }
}
