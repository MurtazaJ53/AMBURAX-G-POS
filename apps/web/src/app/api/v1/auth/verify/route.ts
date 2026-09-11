import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { verifyMfaChallenge } from "@/server/identity/mfaChallenge";
import { env } from "@/lib/env";
import { clientIp } from "@/lib/request";
import { logError } from "@/lib/safeLog";

export const runtime = "nodejs";

const bodySchema = z.object({
  challengeToken: z.string().min(32).max(200),
  code: z.string().trim().regex(/^\d+$/, "Enter the numeric code."),
  remember: z.boolean().optional().default(true),
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
    return NextResponse.json(
      { error: { code: "validation_error", message: "Enter the verification code." }, correlationId },
      { status: 400 },
    );
  }

  let result;
  try {
    result = await verifyMfaChallenge({
      challengeToken: parsed.data.challengeToken,
      code: parsed.data.code,
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });
  } catch (err) {
    logError("auth/verify: identity store unavailable", err, { correlationId });
    return NextResponse.json(
      {
        error: {
          code: "service_unavailable",
          message: "Verification is temporarily unavailable. Please try again shortly.",
        },
        correlationId,
      },
      { status: 503 },
    );
  }

  switch (result.status) {
    case "rate_limited":
      return NextResponse.json(
        { error: { code: "rate_limited", message: "Too many attempts. Try again later." }, correlationId },
        { status: 429 },
      );

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
        {
          error: {
            code: "otp_expired",
            message: "This code has expired. Request a new one or sign in again.",
          },
          correlationId,
        },
        { status: 410 },
      );

    case "too_many_attempts":
      return NextResponse.json(
        {
          error: {
            code: "otp_too_many_attempts",
            message: "Too many incorrect attempts. Request a new code or sign in again.",
          },
          correlationId,
        },
        { status: 429 },
      );

    case "incorrect_code":
      return NextResponse.json(
        {
          error: {
            code: "otp_incorrect",
            message: "That code isn't right.",
            attemptsRemaining: result.attemptsRemaining,
          },
          correlationId,
        },
        { status: 401 },
      );

    case "ok": {
      const res = NextResponse.json(
        {
          status: "ok",
          user: result.user,
          tenant: result.tenant,
          storeCount: result.storeCount,
          correlationId,
        },
        { status: 200 },
      );
      res.cookies.set(env.SESSION_COOKIE_NAME, result.sessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        ...(parsed.data.remember ? { expires: new Date(result.expiresAt) } : {}),
      });
      return res;
    }
  }
}
