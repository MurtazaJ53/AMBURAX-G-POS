import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { login, GENERIC_INVALID_CREDENTIALS } from "@/server/identity/loginService";
import { env } from "@/lib/env";
import { clientIp } from "@/lib/request";
import { logError } from "@/lib/safeLog";

export const runtime = "nodejs";

const bodySchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(200),
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
      { error: { code: "validation_error", message: "Enter a valid email and password." }, correlationId },
      { status: 400 },
    );
  }

  let result;
  try {
    result = await login({
      email: parsed.data.email,
      password: parsed.data.password,
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
      correlationId,
    });
  } catch (err) {
    logError("auth/login: identity store unavailable", err, { correlationId });
    return NextResponse.json(
      {
        error: {
          code: "service_unavailable",
          message: "Sign-in is temporarily unavailable. Please try again shortly.",
        },
        correlationId,
      },
      { status: 503 },
    );
  }

  switch (result.status) {
    case "rate_limited":
      return NextResponse.json(
        {
          error: {
            code: "rate_limited",
            message: "Too many attempts. Try again later.",
          },
          correlationId,
        },
        { status: 429 },
      );

    case "account_locked":
      return NextResponse.json(
        {
          error: {
            code: "account_locked",
            message: "Account temporarily locked due to repeated failed attempts.",
            lockedUntil: result.lockedUntil,
          },
          correlationId,
        },
        { status: 423 },
      );

    case "account_disabled":
      return NextResponse.json(
        {
          error: {
            code: "account_disabled",
            message: "This account has been disabled. Contact your administrator.",
          },
          correlationId,
        },
        { status: 403 },
      );

    case "invalid_credentials":
      return NextResponse.json(
        { error: { code: "invalid_credentials", message: GENERIC_INVALID_CREDENTIALS }, correlationId },
        { status: 401 },
      );

    case "mfa_required":
      return NextResponse.json(
        {
          status: "mfa_required",
          challengeToken: result.challengeToken,
          expiresAt: result.expiresAt,
          maskedDestination: result.maskedDestination,
          ...(result.devCode ? { devCode: result.devCode } : {}),
          correlationId,
        },
        { status: 200 },
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
        // "Keep me signed in" unchecked -> browser-session cookie (cleared on browser close);
        // the underlying server-side session still expires at expiresAt either way.
        ...(parsed.data.remember ? { expires: new Date(result.expiresAt) } : {}),
      });
      return res;
    }
  }
}
