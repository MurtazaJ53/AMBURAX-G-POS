import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { registerBusiness } from "@/server/tenant/registrationService";
import { clientIp } from "@/lib/request";
import { logError } from "@/lib/safeLog";

export const runtime = "nodejs";

const bodySchema = z.object({
  businessName: z.string().trim().min(2).max(200),
  businessType: z.enum(["RETAIL", "WHOLESALE", "MANUFACTURING", "SERVICES", "DISTRIBUTION", "OTHER"]),
  industry: z.string().trim().max(100).optional(),
  country: z.string().trim().min(2).max(100),
  taxId: z.string().trim().max(50).optional(),
  contactEmail: z.string().trim().email().max(255),
  contactPhone: z.string().trim().min(7).max(20),
  termsAccepted: z.literal(true, {
    errorMap: () => ({ message: "You must accept the terms to continue." }),
  }),
  // Client-generated once per form load (crypto.randomUUID()) and reused across
  // retries of the same submission — see registrationService.ts for what this buys.
  idempotencyKey: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_request", message: "Malformed request body." }, correlationId },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      {
        error: {
          code: "validation_error",
          message: first?.message ?? "Check the form and try again.",
          field: first?.path.join(".") || undefined,
        },
        correlationId,
      },
      { status: 400 },
    );
  }

  try {
    const result = await registerBusiness({
      businessName: parsed.data.businessName,
      businessType: parsed.data.businessType,
      industry: parsed.data.industry,
      country: parsed.data.country,
      taxId: parsed.data.taxId,
      contactEmail: parsed.data.contactEmail,
      contactPhone: parsed.data.contactPhone,
      idempotencyKey: parsed.data.idempotencyKey,
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
      correlationId,
    });

    if (result.status === "rate_limited") {
      return NextResponse.json(
        { error: { code: "rate_limited", message: "Too many registration attempts. Try again later." }, correlationId },
        { status: 429 },
      );
    }

    // Deliberately minimal: no raw tenant id/slug — the onboarding token is the only
    // credential A6 needs, and it's opaque (see ADR series on token design).
    return NextResponse.json(
      {
        status: "ok",
        businessName: result.businessName,
        onboardingToken: result.onboardingToken,
        expiresAt: result.expiresAt,
        nextStep: "owner",
        correlationId,
      },
      { status: 201 },
    );
  } catch (err) {
    logError("tenants: registration failed", err, { correlationId });
    return NextResponse.json(
      {
        error: {
          code: "service_unavailable",
          message: "Business registration is temporarily unavailable. Please try again shortly.",
        },
        correlationId,
      },
      { status: 503 },
    );
  }
}
