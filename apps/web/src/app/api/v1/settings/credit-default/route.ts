import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { apiError, forbidden, noStore, serviceUnavailable, unauthorized } from "@/lib/apiError";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { CREDIT_MODES } from "@/server/khata/creditMode";
import {
  getCompanyCreditDefault,
  setCompanyCreditDefault,
  type CompanyCreditSettingsResult,
} from "@/server/khata/companyCreditSettings";
import { resolvePosContext, type PosContext } from "@/server/sales/posContext";

export const runtime = "nodejs";

const updateSchema = z.object({
  mode: z.enum(CREDIT_MODES),
  limitMinor: z.number().int().safe().nullable(),
}).strict();

function mapResult(result: CompanyCreditSettingsResult, correlationId: string): NextResponse {
  switch (result.status) {
    case "forbidden":
      return forbidden(correlationId, "Only the business owner can change the company credit default.");
    case "company_unavailable":
      return apiError({ code: "company_unavailable", message: "Map this store to a legal company before configuring credit.", status: 409, correlationId });
    case "not_found":
      return apiError({ code: "company_unavailable", message: "The company for this store is unavailable.", status: 409, correlationId });
    case "validation_error":
      return apiError({ code: "validation_error", message: result.reason, status: 400, correlationId });
    case "ok":
      return NextResponse.json({ status: "ok", setting: result, correlationId }, { status: 200 });
  }
  return serviceUnavailable(correlationId, "Company credit settings are temporarily unavailable.");
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

export async function GET(req: NextRequest): Promise<NextResponse> {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  try {
    const resolved = await contextFor(req, correlationId);
    if (resolved.kind === "response") return resolved.response;
    return mapResult(await getCompanyCreditDefault(resolved.context), correlationId);
  } catch (err) {
    logError("settings/credit-default: read failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Company credit settings are temporarily unavailable.");
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
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
    return mapResult(await setCompanyCreditDefault({
      actor: resolved.context,
      mode: parsed.data.mode,
      limitMinor: parsed.data.limitMinor,
      correlationId,
    }), correlationId);
  } catch (err) {
    logError("settings/credit-default: update failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Company credit settings could not be saved.");
  }
}
