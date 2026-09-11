import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { acceptInvitation } from "@/server/tenant/invitationAcceptance";
import { clientIp } from "@/lib/request";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";

export const runtime = "nodejs";

// The token is the subject of this request, so it lives in the body — not in the path as
// `/invitations/:id/accept`. An invitation id is not secret and is not proof of anything;
// the token is both. Documented as a deliberate deviation in SCREEN_API_MATRIX.md.
const bodySchema = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/, "invalid"),
  name: z.string().trim().min(2).max(200).optional(),
  password: z.string().min(1).max(200).optional(),
  confirmPassword: z.string().min(1).max(200).optional(),
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
      { error: { code: "validation_error", message: "This invitation link is invalid." }, correlationId },
      { status: 400 },
    );
  }

  if (
    parsed.data.password !== undefined &&
    parsed.data.confirmPassword !== undefined &&
    parsed.data.password !== parsed.data.confirmPassword
  ) {
    return NextResponse.json(
      { error: { code: "password_mismatch", message: "Passwords do not match." }, correlationId },
      { status: 400 },
    );
  }

  try {
    const result = await acceptInvitation({
      token: parsed.data.token,
      name: parsed.data.name,
      password: parsed.data.password,
      sessionToken: req.cookies.get(env.SESSION_COOKIE_NAME)?.value,
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

      case "invalid":
        return NextResponse.json(
          { error: { code: "invalid_invitation", message: "This invitation link is not valid." }, correlationId },
          { status: 401 },
        );

      case "expired":
        return NextResponse.json(
          {
            error: { code: "invitation_expired", message: "This invitation has expired. Ask for a new one." },
            correlationId,
          },
          { status: 410 },
        );

      case "revoked":
        return NextResponse.json(
          {
            error: { code: "invitation_revoked", message: "This invitation was cancelled." },
            correlationId,
          },
          { status: 410 },
        );

      case "already_accepted":
        return NextResponse.json(
          {
            error: {
              code: "invitation_already_accepted",
              message: "This invitation has already been used. Sign in to continue.",
            },
            correlationId,
          },
          { status: 409 },
        );

      case "identity_mismatch":
        return NextResponse.json(
          {
            error: {
              code: "identity_mismatch",
              message: "This invitation was sent to a different email. Sign out and open it again.",
            },
            correlationId,
          },
          { status: 403 },
        );

      case "identity_conflict":
        return NextResponse.json(
          {
            error: {
              code: "identity_conflict",
              message: "This email can't be used to join this business. Contact whoever invited you.",
            },
            correlationId,
          },
          { status: 409 },
        );

      case "account_disabled":
        return NextResponse.json(
          {
            error: { code: "account_disabled", message: "This account has been disabled." },
            correlationId,
          },
          { status: 403 },
        );

      case "login_required":
        return NextResponse.json(
          {
            error: {
              code: "login_required",
              message: "You already have an account. Sign in first, then open this invitation again.",
            },
            correlationId,
          },
          { status: 401 },
        );

      case "weak_password":
        return NextResponse.json(
          { error: { code: "weak_password", message: result.reason }, correlationId },
          { status: 400 },
        );

      case "validation_error":
        return NextResponse.json(
          { error: { code: "validation_error", message: result.reason }, correlationId },
          { status: 400 },
        );

      case "already_member":
        return NextResponse.json(
          {
            error: { code: "already_member", message: "You already have access to this store." },
            correlationId,
          },
          { status: 409 },
        );

      case "ok": {
        const res = NextResponse.json(
          {
            status: "ok",
            user: result.user,
            tenant: result.tenant,
            store: result.store,
            role: result.role,
            // Tells the client whether it is now signed in or should go to /auth/login.
            authenticated: !!result.sessionToken,
            correlationId,
          },
          { status: 201 },
        );
        // A session is set ONLY on the new-account path. An existing account already had
        // one; minting another from invitation possession is the takeover path A11 blocks.
        if (result.sessionToken && result.expiresAt) {
          res.cookies.set(env.SESSION_COOKIE_NAME, result.sessionToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/",
            expires: new Date(result.expiresAt),
          });
        }
        return res;
      }
    }
  } catch (err) {
    logError("invitations/accept: failed", err, { correlationId });
    return NextResponse.json(
      {
        error: {
          code: "service_unavailable",
          message: "Accepting invitations is temporarily unavailable. Please try again shortly.",
        },
        correlationId,
      },
      { status: 503 },
    );
  }
}
