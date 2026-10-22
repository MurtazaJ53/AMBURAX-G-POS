import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { processExchange, ExchangeDomainError } from "@/server/sales/exchangeService";

export const runtime = "nodejs";

const exchangeSchema = z.object({
  posSessionId: z.string().trim().nullish(),
  returnItems: z
    .array(
      z.object({
        originalSaleItemId: z.string().trim().min(1),
        quantity: z.number().int().min(1),
      })
    )
    .min(1, "At least one item must be returned."),
  newLines: z
    .array(
      z.object({
        variantId: z.string().trim().min(1),
        quantity: z.number().int().min(1),
      })
    )
    .min(1, "At least one replacement item must be selected."),
  settlement: z.object({
    method: z.enum(["CASH", "UPI", "CARD"]),
    reference: z.string().trim().optional(),
  }),
  reason: z.string().trim().min(3).max(200),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  const resolvedParams = await params;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return forbidden(correlationId, "Store context required.");

    const body = await req.json().catch(() => null);
    const parsed = exchangeSchema.safeParse(body);
    if (!parsed.success) {
      return apiError({
        code: "invalid_input",
        message: parsed.error.issues[0]?.message ?? "Invalid exchange payload.",
        status: 400,
        correlationId,
      });
    }

    const result = await processExchange({
      tenantId: resolved.context.tenantId,
      storeId: resolved.context.storeId,
      originalSaleId: resolvedParams.id,
      actor: {
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
        membershipRole: resolved.context.membershipRole,
      },
      posSessionId: parsed.data.posSessionId,
      returnItems: parsed.data.returnItems,
      newLines: parsed.data.newLines,
      settlement: parsed.data.settlement,
      reason: parsed.data.reason,
    });

    return NextResponse.json({ status: "ok", exchange: result, correlationId });
  } catch (err) {
    if (err instanceof ExchangeDomainError) {
      return apiError({
        code: err.code.toLowerCase(),
        message: err.message,
        status: 400,
        correlationId,
      });
    }
    logError("sales:exchange: failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Exchange processing failed.");
  }
}
