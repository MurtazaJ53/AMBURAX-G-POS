import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, forbidden, noStore, unauthorized, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { collectRepayment } from "@/server/khata/repayment";

export const runtime = "nodejs";

// Tenant, store, Company and currency come from the session and the persisted store, never the body.
const collectPaymentSchema = z.object({
  customerId: z.string().trim().min(1),
  /** Cash: what the customer handed over (change is worked out). UPI/card: the amount paid. */
  amountMinor: z.number().int().positive("Payment amount must be greater than zero"),
  paymentMethod: z.enum(["CASH", "UPI", "CARD"]).default("CASH"),
  reference: z.string().trim().max(100).optional(),
  idempotencyKey: z.string().trim().min(8).max(200),
}).strict();

/**
 * Collect a Khata repayment (Q6/Q7, owner 2026-10-14): settles the oldest bills first, refuses
 * overpayment (cash returns change), and records allocations on the ledger. See khata/repayment.ts.
 */
export async function POST(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError({ code: "invalid_request", message: "Malformed request body.", status: 400, correlationId });
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
    if (resolved.status === "no_store") return noStore(correlationId);
    // Collecting money at the counter is a selling task.
    if (!resolved.context.canSell) return forbidden(correlationId, "Your role can't take payments in this store.");

    const result = await collectRepayment({
      actor: { tenantId: resolved.context.tenantId, userId: resolved.context.userId },
      storeId: resolved.context.storeId,
      customerId: parsed.data.customerId,
      method: parsed.data.paymentMethod,
      tenderedMinor: parsed.data.amountMinor,
      reference: parsed.data.reference ?? null,
      idempotencyKey: parsed.data.idempotencyKey,
      correlationId,
    });

    switch (result.status) {
      case "ok":
        return NextResponse.json({ ...result, correlationId }, { status: 200 });
      case "not_found":
        return apiError({ code: "not_found", message: "Customer not found.", status: 404, correlationId });
      case "company_unavailable":
        return apiError({
          code: "khata_scope_unavailable",
          message: "This store is not mapped to a legal company and currency, so khata payments cannot be collected.",
          status: 409,
          correlationId,
        });
      case "nothing_due":
        return apiError({ code: "nothing_due", message: "This customer owes nothing here.", status: 409, correlationId });
      case "validation_error":
        return apiError({ code: "validation_error", message: result.reason, status: 400, correlationId });
    }
  } catch (err: unknown) {
    logError("khata: collect payment failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Could not collect khata payment.");
  }
}
