import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requestPasswordReset } from "@/server/identity/passwordReset";
import { clientIp } from "@/lib/request";

export const runtime = "nodejs";

const bodySchema = z.object({
  email: z.string().trim().email().max(255),
});

// Same message for every non-rate-limited outcome — unknown email, disabled account,
// cooldown-throttled repeat, and a freshly issued link all render identically. See
// SCREEN_SPECIFICATIONS.md A3: "always return a privacy-safe response without
// revealing account existence."
const GENERIC_ACCEPTED_MESSAGE = "If an account exists for that email, we've sent a password reset link.";

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
    return NextResponse.json(
      { error: { code: "validation_error", message: "Enter a valid email address." }, correlationId },
      { status: 400 },
    );
  }

  try {
    const result = await requestPasswordReset({
      email: parsed.data.email,
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
      correlationId,
    });

    if (result.status === "rate_limited") {
      // Safe to disclose distinctly: this is about the requester's own request volume,
      // not about whether the target account exists.
      return NextResponse.json(
        { error: { code: "rate_limited", message: "Too many requests. Try again later." }, correlationId },
        { status: 429 },
      );
    }

    return NextResponse.json(
      {
        status: "accepted",
        message: GENERIC_ACCEPTED_MESSAGE,
        ...(result.devResetLink ? { devResetLink: result.devResetLink } : {}),
        correlationId,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("[auth/password/reset-request] identity store unavailable", { correlationId, err });
    // Deliberately still generic-shaped, not a raw 500 — a distinguishable failure mode
    // here would itself be an enumeration/behavior oracle for a scripted attacker.
    return NextResponse.json(
      {
        error: {
          code: "service_unavailable",
          message: "Password reset is temporarily unavailable. Please try again shortly.",
        },
        correlationId,
      },
      { status: 503 },
    );
  }
}
