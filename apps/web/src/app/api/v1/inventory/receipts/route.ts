import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { receiveStock } from "@/server/inventory/inventoryService";

export const runtime = "nodejs";

/**
 * Receive stock into a store. The endpoint that makes stock able to rise at all — until this
 * phase the only stock writer in the entire system was the POS decrement.
 *
 * `tenantId` is absent from the schema below on purpose, and is ignored if sent: it comes from
 * the resolved session, never from the caller.
 */
const receiptSchema = z.object({
  storeId: z.string().min(1),
  variantId: z.string().min(1),
  quantity: z.number().int().positive(),
  reason: z.string().trim().max(500).optional(),
  /** Request identity, so a double-submit does not receive the goods twice. */
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

  const parsed = receiptSchema.safeParse(body);
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

    const result = await receiveStock({
      actor: {
        tenantId: resolved.context.tenantId,
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
      },
      storeId: parsed.data.storeId,
      variantId: parsed.data.variantId,
      quantity: parsed.data.quantity,
      reason: parsed.data.reason ?? null,
      requestKey: parsed.data.requestKey,
      correlationId,
    });

    if (result.status === "forbidden") {
      return forbidden(correlationId, "You do not have permission to receive stock.");
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
        correlationId,
      },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (err) {
    logError("inventory: receipt failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Receiving stock is temporarily unavailable.");
  }
}
