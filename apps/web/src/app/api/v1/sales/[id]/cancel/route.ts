import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { cancelSale, CancelDomainError } from "@/server/sales/saleCancelService";

export const runtime = "nodejs";

const cancelSchema = z.object({
  reason: z.string().trim().min(3, "Reason is required (min 3 chars)").max(200),
  approval: z
    .object({
      approverUserId: z.string().trim().min(1),
      pin: z.string().regex(/^\d{4,6}$/),
    })
    .optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  const resolvedParams = await params;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return forbidden(correlationId, "Store context required.");

    const body = await req.json().catch(() => null);
    const parsed = cancelSchema.safeParse(body);
    if (!parsed.success) {
      return apiError({
        code: "invalid_input",
        message: parsed.error.issues[0]?.message ?? "Invalid cancellation parameters.",
        status: 400,
        correlationId,
      });
    }

    const res = await cancelSale({
      tenantId: resolved.context.tenantId,
      storeId: resolved.context.storeId,
      saleId: resolvedParams.id,
      actor: {
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
        membershipRole: resolved.context.membershipRole,
      },
      reason: parsed.data.reason,
      approval: parsed.data.approval,
    });

    return NextResponse.json({ status: "ok", sale: res.sale, correlationId });
  } catch (err) {
    if (err instanceof CancelDomainError) {
      return apiError({
        code: err.code.toLowerCase(),
        message: err.message,
        status: 400,
        correlationId,
      });
    }
    logError("sales:cancel: failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Bill cancellation failed.");
  }
}
