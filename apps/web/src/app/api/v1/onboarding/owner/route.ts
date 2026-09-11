import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createOwnerAccount } from "@/server/tenant/ownerSetup";
import { clientIp } from "@/lib/request";
import { env } from "@/lib/env";

export const runtime = "nodejs";

const bodySchema = z
  .object({
    onboardingToken: z.string().regex(/^[0-9a-f]{64}$/, "invalid"),
    name: z.string().trim().min(2).max(200),
    email: z.string().trim().email().max(255),
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
          message: mismatch ? "Passwords do not match." : "Check the form and try again.",
        },
        correlationId,
      },
      { status: 400 },
    );
  }

  try {
    const result = await createOwnerAccount({
      onboardingToken: parsed.data.onboardingToken,
      name: parsed.data.name,
      email: parsed.data.email,
      password: parsed.data.password,
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
      correlationId,
    });

    switch (result.status) {
      case "rate_limited":
        return NextResponse.json(
          { error: { code: "rate_limited", message: "Too many attempts. Try again later." }, correlationId },
          { status: 429 },
        );

      case "invalid_session":
        return NextResponse.json(
          {
            error: {
              code: "invalid_session",
              message: "This setup link is invalid or has expired. Please register your business again.",
            },
            correlationId,
          },
          { status: 401 },
        );

      case "already_completed":
        return NextResponse.json(
          {
            error: {
              code: "already_completed",
              message: "Owner setup for this business is already complete. Sign in instead.",
            },
            correlationId,
          },
          { status: 409 },
        );

      case "weak_password":
        return NextResponse.json(
          { error: { code: "weak_password", message: result.reason }, correlationId },
          { status: 400 },
        );

      case "email_taken":
        return NextResponse.json(
          { error: { code: "email_taken", message: "An account with this email already exists." }, correlationId },
          { status: 409 },
        );

      case "ok": {
        const res = NextResponse.json(
          {
            status: "ok",
            user: result.user,
            tenant: result.tenant,
            correlationId,
          },
          { status: 201 },
        );
        // Completing owner setup is account creation, not a recovery flow — establishing
        // a real session here (unlike A4's reset, ADR-033) matches standard signup UX and
        // is what the identity-hierarchy diagram this screen was built from calls for.
        res.cookies.set(env.SESSION_COOKIE_NAME, result.sessionToken, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          expires: new Date(result.expiresAt),
        });
        return res;
      }
    }
  } catch (err) {
    console.error("[onboarding/owner] identity store unavailable", { correlationId, err });
    return NextResponse.json(
      {
        error: {
          code: "service_unavailable",
          message: "Owner setup is temporarily unavailable. Please try again shortly.",
        },
        correlationId,
      },
      { status: 503 },
    );
  }
}
