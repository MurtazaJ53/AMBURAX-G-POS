import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { consumePasswordReset } from "@/server/identity/passwordReset";
import { clientIp } from "@/lib/request";

export const runtime = "nodejs";

const bodySchema = z
  .object({
    // 32 bytes, hex-encoded (see token.ts's generateOpaqueToken). A malformed token is
    // rejected here without ever touching the database — same as an unknown one, it's
    // just a cheaper way to say "invalid".
    token: z.string().regex(/^[0-9a-f]{64}$/, "invalid"),
    password: z.string().min(1).max(200),
    confirmPassword: z.string().min(1).max(200),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
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
    const mismatch = parsed.error.issues.some((i) => i.path.includes("confirmPassword"));
    return NextResponse.json(
      {
        error: {
          code: mismatch ? "password_mismatch" : "validation_error",
          message: mismatch ? "Passwords do not match." : "This reset link is invalid.",
        },
        correlationId,
      },
      { status: 400 },
    );
  }

  try {
    const result = await consumePasswordReset({
      token: parsed.data.token,
      newPassword: parsed.data.password,
      ip: clientIp(req),
      correlationId,
    });

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
              code: "invalid_token",
              message: "This reset link is invalid or has already been used.",
            },
            correlationId,
          },
          { status: 401 },
        );

      case "expired":
        return NextResponse.json(
          {
            error: {
              code: "expired_token",
              message: "This reset link has expired. Request a new one.",
            },
            correlationId,
          },
          { status: 410 },
        );

      case "weak_password":
        return NextResponse.json(
          { error: { code: "weak_password", message: result.reason }, correlationId },
          { status: 400 },
        );

      case "same_as_current":
        return NextResponse.json(
          {
            error: {
              code: "same_as_current",
              message: "Choose a different password than your current one.",
            },
            correlationId,
          },
          { status: 400 },
        );

      case "ok":
        // Deliberately no session cookie is set here — a successful reset does not log
        // the user in. See DECISIONS.md: password reset must not create an authenticated
        // session unless the architecture explicitly says so, and it doesn't.
        return NextResponse.json(
          { status: "ok", message: "Password updated. Sign in with your new password.", correlationId },
          { status: 200 },
        );
    }
  } catch (err) {
    console.error("[auth/password/reset] identity store unavailable", { correlationId, err });
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
