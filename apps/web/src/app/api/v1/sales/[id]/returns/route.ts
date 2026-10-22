import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import {
  apiError,
  unauthorized,
  noStore,
  serviceUnavailable,
} from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { logError } from "@/lib/safeLog";
import { createReturn, ReturnDomainError } from "@/server/sales/returnService";
import { env } from "@/lib/env";

const createReturnSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  reason: z.string().trim().max(500).optional(),
  amburaxExchangeId: z.string().trim().optional(),
  // E7: the till paying the refund. Checked on the server against the caller's own rights.
  posSessionId: z.string().trim().min(1).max(64).optional(),
  items: z
    .array(
      z.object({
        originalSaleItemId: z.string().trim().min(1),
        quantity: z.number().int().min(1),
      }),
    )
    .min(1, "Add at least one item to return."),
  refundPayments: z.array(z.object({
    method: z.enum(["CASH", "UPI", "CARD"]),
    amountMinor: z.number().int().min(1),
    reference: z.string().trim().max(100).optional(),
  })).min(1, "Provide at least one refund method."),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: saleId } = await params;
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

  const parsed = createReturnSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Check the return payload and try again.",
      status: 400,
      correlationId,
    });
  }

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const result = await createReturn({
      tenantId: resolved.context.tenantId,
      storeId: resolved.context.storeId,
      // Session-derived, like the tenant and store above. A body that named its own role would
      // be ignored, not honoured.
      actor: {
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
        membershipRole: resolved.context.membershipRole,
      },
      originalSaleId: saleId,
      idempotencyKey: parsed.data.idempotencyKey,
      reason: parsed.data.reason,
      amburaxExchangeId: parsed.data.amburaxExchangeId,
      items: parsed.data.items,
      refundPayments: parsed.data.refundPayments,
      posSessionId: parsed.data.posSessionId ?? null,
    });

    return NextResponse.json(
      { status: "ok", saleReturn: result.saleReturn, duplicate: result.duplicate, correlationId },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (err) {
    if (err instanceof ReturnDomainError) {
      let status = 400;
      if (err.code === "NOT_FOUND") status = 404;
      if (err.code === "FORBIDDEN") status = 403;
      if (err.code === "CASH_SHORT" || err.code === "CONFLICT") status = 409;
      
      return apiError({
        code: err.code.toLowerCase(),
        message: err.message,
        status,
        correlationId,
      });
    }

    logError("returns: create failed", err, { correlationId });
    return serviceUnavailable(
      correlationId,
      "The return could not be completed. Nothing was processed - please try again.",
    );
  }
}
