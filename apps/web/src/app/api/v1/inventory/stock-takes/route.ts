import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { recordStockTake } from "@/server/inventory/inventoryService";

export const runtime = "nodejs";

/**
 * Record a physical count.
 *
 * The caller sends what is on the shelf, not a delta — the server works out the difference
 * against the current balance. Asking for a delta would make the counter do arithmetic against
 * a number they cannot see, which is how counts get entered backwards.
 *
 * `tenantId` comes from the resolved session, never from the caller.
 */
const stockTakeSchema = z.object({
  storeId: z.string().min(1),
  variantId: z.string().min(1),
  countedQuantity: z.number().int().min(0),
  reason: z.string().trim().max(500).optional(),
  requestKey: z.string().trim().min(8).max(200),
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

  const parsed = stockTakeSchema.safeParse(body);
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

    const result = await recordStockTake({
      actor: {
        tenantId: resolved.context.tenantId,
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
      },
      storeId: parsed.data.storeId,
      variantId: parsed.data.variantId,
      countedQuantity: parsed.data.countedQuantity,
      reason: parsed.data.reason ?? null,
      requestKey: parsed.data.requestKey,
      correlationId,
    });

    if (result.status === "forbidden") {
      return forbidden(correlationId, "You do not have permission to record a stock take.");
    }
    if (result.status === "not_found") {
      // Deliberately the same answer for "belongs to another tenant" and "does not exist".
      return apiError({
        code: "not_found",
        message: "That store or product could not be found.",
        status: 404,
        correlationId,
      });
    }
    if (result.status === "invalid_quantity" || result.status === "validation_error") {
      return apiError({
        code: "validation_error",
        message:
          result.status === "validation_error" ? result.reason : "Enter a valid whole quantity.",
        status: 400,
        correlationId,
      });
    }

    return NextResponse.json(
      {
        status: "ok",
        movementId: result.movementId,
        balanceAfter: result.balanceAfter,
        duplicate: result.duplicate,
        // Zero means the count matched the system and nothing was written.
        delta: result.delta,
        correlationId,
      },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (err) {
    logError("inventory: stock take failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Recording a stock take is temporarily unavailable.");
  }
}
