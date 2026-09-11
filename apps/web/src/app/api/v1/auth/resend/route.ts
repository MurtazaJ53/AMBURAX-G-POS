import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { resendMfaChallenge } from "@/server/identity/mfaChallenge";
import { isIpRateLimited, recordAttempt } from "@/server/identity/loginGuard";
import { env } from "@/lib/env";
import { clientIp } from "@/lib/request";

export const runtime = "nodejs";

const bodySchema = z.object({
  challengeToken: z.string().min(32).max(200),
  channel: z.enum(["SMS", "WHATSAPP", "EMAIL"]).optional(),
});

export async function POST(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const ip = clientIp(req);

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
      { error: { code: "validation_error", message: "Invalid resend request." }, correlationId },
      { status: 400 },
    );
  }

  try {
    // Separate, tighter window than verify guessing — resend abuse is SMS-cost abuse, not just brute force.
    if (await isIpRateLimited(ip, "mfa_resend", { windowMs: 15 * 60 * 1000, threshold: env.OTP_MAX_RESENDS * 3 })) {
      return NextResponse.json(
        { error: { code: "rate_limited", message: "Too many resend requests. Try again later." }, correlationId },
        { status: 429 },
      );
    }

    const result = await resendMfaChallenge({
      challengeToken: parsed.data.challengeToken,
      ip,
      channel: parsed.data.channel,
    });

    await recordAttempt({
      email: "unknown", // resend doesn't resolve to an email before we know the challenge is valid
      ip,
      success: result.status === "ok",
      reason: result.status,
      context: "mfa_resend",
    });

    switch (result.status) {
      case "invalid":
        return NextResponse.json(
          {
            error: {
              code: "invalid_challenge",
              message: "This verification session is invalid. Please sign in again.",
            },
            correlationId,
          },
          { status: 401 },
        );

      case "expired":
        return NextResponse.json(
          { error: { code: "otp_expired", message: "This verification session has expired. Sign in again." }, correlationId },
          { status: 410 },
        );

      case "cooldown":
        return NextResponse.json(
          {
            error: {
              code: "resend_cooldown",
              message: `Please wait before requesting another code.`,
              retryAfterSeconds: result.retryAfterSeconds,
            },
            correlationId,
          },
          { status: 429 },
        );

      case "max_resends":
        return NextResponse.json(
          {
            error: {
              code: "resend_limit_reached",
              message: "You've reached the resend limit for this sign-in. Please sign in again.",
            },
            correlationId,
          },
          { status: 429 },
        );

      case "ok":
        return NextResponse.json(
          {
            status: "ok",
            expiresAt: result.expiresAt,
            maskedDestination: result.maskedDestination,
            ...(result.devCode ? { devCode: result.devCode } : {}),
            correlationId,
          },
          { status: 200 },
        );
    }
  } catch (err) {
    console.error("[auth/resend] identity store unavailable", { correlationId, err });
    return NextResponse.json(
      {
        error: {
          code: "service_unavailable",
          message: "Resend is temporarily unavailable. Please try again shortly.",
        },
        correlationId,
      },
      { status: 503 },
    );
  }
}
