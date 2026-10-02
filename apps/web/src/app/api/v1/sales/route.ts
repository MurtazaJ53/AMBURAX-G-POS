import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { createSale } from "@/server/sales/saleService";
import { MAX_LINES_PER_SALE, MAX_LINE_QUANTITY } from "@/server/sales/saleTotals";
import { listSales } from "@/server/sales/saleQueries";

export const runtime = "nodejs";

/**
 * Sale history for the signed-in tenant.
 *
 * Scoped to the caller's tenant, and further to their current store: a cashier's history
 * view is their till's history, not the whole business's.
 */
export async function GET(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const sales = await listSales({
      tenantId: resolved.context.tenantId,
      storeId: resolved.context.storeId,
      query: (req.nextUrl.searchParams.get("q") ?? "").slice(0, 100),
      limit: 50,
    });

    return NextResponse.json({ status: "ok", sales, correlationId }, { status: 200 });
  } catch (err) {
    logError("sales: history failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Sale history is temporarily unavailable.");
  }
}

/**
 * What the client is allowed to send.
 *
 * Note what is absent: no prices, no tax rates, no line totals, no grand total, no paid
 * amount, no tenant id, no store id, no cashier id. The client names *what* is being sold
 * and *how* it is being paid for; every number that decides what the customer is charged
 * is read from the database inside the sale transaction.
 *
 * Quantity bounds are duplicated from saleTotals here on purpose — this is input hygiene,
 * rejecting nonsense at the edge; the domain re-validates regardless, because a schema at
 * the boundary is not an authorization or integrity control.
 */
const createSaleSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  lines: z
    .array(
      z.object({
        variantId: z.string().trim().min(1),
        quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
      }),
    )
    .min(1, "Add at least one item.")
    .max(MAX_LINES_PER_SALE),
  customerId: z.string().trim().min(1).nullish(),
  // The shift this sale is rung up in. Optional, and verified server-side — naming a shift
  // here does not make it yours, open, or this store's.
  posSessionId: z.string().trim().min(1).nullish(),
  discountMinor: z.number().int().min(0).optional(),
  payment: z.object({
    method: z.enum(["CASH", "UPI", "CARD"]),
    amountMinor: z.number().int().optional(),
    reference: z.string().trim().max(100).optional(),
  }).optional(),
  payments: z.array(z.object({
    method: z.enum(["CASH", "UPI", "CARD"]),
    amountMinor: z.number().int().min(1),
    reference: z.string().trim().max(100).optional(),
  })).optional(),
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

  const parsed = createSaleSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Check the cart and try again.",
      status: 400,
      correlationId,
    });
  }

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const result = await createSale({
      tenantId: resolved.context.tenantId,
      storeId: resolved.context.storeId,
      cashierUserId: resolved.context.userId,
      idempotencyKey: parsed.data.idempotencyKey,
      lines: parsed.data.lines,
      customerId: parsed.data.customerId ?? null,
      posSessionId: parsed.data.posSessionId ?? null,
      discountMinor: parsed.data.discountMinor ?? 0,
      payment: parsed.data.payment,
      payments: parsed.data.payments,
      correlationId,
    });

    switch (result.status) {
      case "forbidden":
        return forbidden(correlationId, "You do not have permission to complete sales in this store.");

      // 404, not 403, and deliberately so. docs/architecture/CAPABILITIES.md froze this at P1-7:
      // "A disabled capability produces the same response as an unknown route, not a permission
      // error: whether a tenant has bought a module is not information their API surface should
      // volunteer." A 403 naming the capability would turn every endpoint into an oracle for
      // which modules a tenant has, readable by anyone who can reach it.
      //
      // The service result still says `capability_disabled` — the distinction is preserved
      // inside the process, for logs and for in-process callers, and flattened at the boundary.
      case "capability_disabled":
        return apiError({
          code: "not_found",
          message: "Not found.",
          status: 404,
          correlationId,
        });

      case "validation_error":
        return apiError({
          code: "validation_error",
          message: (result as any).reason,
          status: 400,
          correlationId,
        });

      case "empty_cart":
        return apiError({
          code: "empty_cart",
          message: "Add at least one item before taking payment.",
          status: 400,
          correlationId,
        });

      case "too_many_lines":
        return apiError({
          code: "too_many_lines",
          message: `A sale cannot have more than ${MAX_LINES_PER_SALE} lines.`,
          status: 400,
          correlationId,
        });

      case "invalid_quantity":
        return apiError({
          code: "invalid_quantity",
          message: result.reason,
          status: 400,
          correlationId,
        });

      // An unknown variant id is reported as a plain not-found rather than
      // "belongs to another tenant": the lookup was tenant-scoped, so a foreign id and a
      // nonexistent id are indistinguishable here, and that is the point.
      case "unknown_variant":
        return apiError({
          code: "unknown_variant",
          message: "One of the items is no longer available. Remove it and try again.",
          status: 404,
          correlationId,
        });

      case "inactive_variant":
        return apiError({
          code: "inactive_variant",
          message: "One of the items is no longer for sale. Remove it and try again.",
          status: 409,
          correlationId,
        });

      // The shift is closed, another cashier's, or another store's. A conflict rather than a
      // permission failure: the caller may well be allowed to sell, just not into that shift.
      case "invalid_session":
        return apiError({
          code: "invalid_session",
          message: result.reason,
          status: 409,
          correlationId,
        });

      case "unknown_customer":
        return apiError({
          code: "unknown_customer",
          message: "That customer could not be found. Clear the customer and try again.",
          status: 404,
          correlationId,
        });

      case "ok":
        // A duplicate submission returns the original sale with 200 rather than 201, and
        // says so. The operator sees success, because the sale really did happen — the
        // status code is what tells a client it did not happen twice.
        return NextResponse.json(
          { status: "ok", sale: result.sale, duplicate: result.duplicate, correlationId },
          { status: result.duplicate ? 200 : 201 },
        );
    }
  } catch (err) {
    logError("sales: create failed", err, { correlationId });
    // Deliberately not a success shape. The transaction rolled back, so there is no sale,
    // no stock movement and no outbox event; telling the till otherwise would be the worst
    // possible lie at a counter with a customer standing at it.
    return serviceUnavailable(
      correlationId,
      "The sale could not be completed. Nothing was charged — please try again.",
    );
  }
}
