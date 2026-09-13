import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { adjustStock } from "@/server/inventory/inventoryService";

export const runtime = "nodejs";

/**
 * Correct a stock balance, with a reason.
 *
 * Separate from a receipt because the two mean different things to an auditor: a receipt says
 * goods arrived, an adjustment says the records were wrong. Collapsing them would make
 * shrinkage indistinguishable from supply.
 *
 * `tenantId` comes from the resolved session, never from the caller.
 */
const adjustmentSchema = z.object({
  storeId: z.string().min(1),
  variantId: z.string().min(1),
  /** Signed and non-zero. Negative writes stock off; positive corrects an undercount. */
  quantityDelta: z.number().int().refine((v) => v !== 0, "Enter a non-zero adjustment."),
  reason: z.string().trim().min(3, "Say why the stock is being adjusted.").max(500),
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

  const parsed = adjustmentSchema.safeParse(body);
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

    const result = await adjustStock({
      actor: {
        tenantId: resolved.context.tenantId,
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
      },
      storeId: parsed.data.storeId,
      variantId: parsed.data.variantId,
      quantityDelta: parsed.data.quantityDelta,
      reason: parsed.data.reason,
      requestKey: parsed.data.requestKey,
      correlationId,
    });

    if (result.status === "forbidden") {
      return forbidden(correlationId, "You do not have permission to adjust stock.");
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
    logError("inventory: adjustment failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Adjusting stock is temporarily unavailable.");
  }
}
