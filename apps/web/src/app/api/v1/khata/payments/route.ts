import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { ErpKhataService } from "@/server/khata/khataService";

export const runtime = "nodejs";

const collectPaymentSchema = z.object({
  customerId: z.string().trim().min(1),
  amountMinor: z.number().int().positive("Payment amount must be greater than zero"),
  paymentMethod: z.enum(["CASH", "UPI", "CARD"]).default("CASH"),
  reference: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().trim().min(8).max(200),
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

  const parsed = collectPaymentSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Invalid payment data.",
      status: 400,
      correlationId,
    });
  }

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") {
      const { noStore } = await import("@/lib/apiError");
      return noStore(correlationId);
    }

    const khataService = new ErpKhataService();
    const result = await khataService.collectCustomerPayment({
      tenantId: resolved.context.tenantId,
      customerId: parsed.data.customerId,
      actorUserId: resolved.context.userId,
      amountMinor: parsed.data.amountMinor,
      paymentMethod: parsed.data.paymentMethod,
      reference: parsed.data.reference,
      notes: parsed.data.notes,
      idempotencyKey: parsed.data.idempotencyKey,
      correlationId,
    });

    return NextResponse.json({
      status: "ok",
      payment: result.payment,
      duplicate: result.duplicate,
      correlationId,
    }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("not found")) {
      return apiError({
        code: "not_found",
        message: err.message,
        status: 404,
        correlationId,
      });
    }
    logError("khata: collect payment failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Could not collect khata payment.");
  }
}
