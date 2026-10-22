import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { apiError, forbidden, noStore, serviceUnavailable, unauthorized } from "@/lib/apiError";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { CREDIT_MODES } from "@/server/khata/creditMode";
import {
  getCustomerCreditMode,
  setCustomerCreditHold,
  setCustomerCreditMode,
  type CustomerCreditModeResult,
} from "@/server/khata/customerCreditOverride";
import { resolvePosContext, type PosContext } from "@/server/sales/posContext";

export const runtime = "nodejs";

// Only the mode and limit. Tenant, Store and Company come from the session and persisted Store,
// so `.strict()` refuses any attempt to post a scope id.
// Q10: every change carries a reason, which is audited with the old and new values.
const updateSchema = z.union([
  z.object({
    mode: z.enum(CREDIT_MODES),
    limitMinor: z.number().int().safe().nullable(),
    reason: z.string().trim().min(3, "Give a reason for the change.").max(200),
  }).strict(),
  z.object({
    hold: z.boolean(),
    reason: z.string().trim().min(3, "Give a reason for the change.").max(200),
  }).strict(),
]);

function mapResult(result: CustomerCreditModeResult, correlationId: string): NextResponse {
  switch (result.status) {
    case "forbidden":
      return forbidden(correlationId, "Only the owner or the accountant can change a customer's Udhar access.");
    case "company_unavailable":
      return apiError({ code: "company_unavailable", message: "Map this store to a legal company before configuring credit.", status: 409, correlationId });
    case "not_found":
      return apiError({ code: "not_found", message: "Customer not found.", status: 404, correlationId });
    case "validation_error":
      return apiError({ code: "validation_error", message: result.reason, status: 400, correlationId });
    case "ok":
      return NextResponse.json({ status: "ok", credit: result.view, changed: result.changed, correlationId }, { status: 200 });
  }
  return serviceUnavailable(correlationId, "Customer credit settings are temporarily unavailable.");
}

async function contextFor(req: NextRequest, correlationId: string): Promise<
  { kind: "response"; response: NextResponse } | { kind: "context"; context: PosContext }
> {
  const token = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status === "unauthorized") return { kind: "response", response: unauthorized(correlationId) };
  if (resolved.status === "no_store") return { kind: "response", response: noStore(correlationId) };
  return { kind: "context", context: resolved.context };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const { id } = await ctx.params;
  try {
    const resolved = await contextFor(req, correlationId);
    if (resolved.kind === "response") return resolved.response;
    return mapResult(await getCustomerCreditMode({ actor: resolved.context, customerId: id }), correlationId);
  } catch (err) {
    logError("customers/credit-mode: read failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Customer credit settings are temporarily unavailable.");
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError({ code: "invalid_request", message: "Malformed request body.", status: 400, correlationId });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Check the credit setting.", status: 400, correlationId });
  }

  try {
    const resolved = await contextFor(req, correlationId);
    if (resolved.kind === "response") return resolved.response;
    const data = parsed.data;
    if ("hold" in data) {
      return mapResult(
        await setCustomerCreditHold({ actor: resolved.context, customerId: id, hold: data.hold, reason: data.reason, correlationId }),
        correlationId,
      );
    }
    return mapResult(await setCustomerCreditMode({
      actor: resolved.context,
      customerId: id,
      mode: data.mode,
      limitMinor: data.limitMinor,
      reason: data.reason,
      correlationId,
    }), correlationId);
  } catch (err) {
    logError("customers/credit-mode: update failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Customer credit settings could not be saved.");
  }
}
