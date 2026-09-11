import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { resendInvitation } from "@/server/tenant/invitation";
import { clientIp } from "@/lib/request";
import { env } from "@/lib/env";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Sign in required." }, correlationId }, { status: 401 });
  }

  const { id } = await params;

  try {
    const result = await resendInvitation({ sessionToken, invitationId: id, ip: clientIp(req), correlationId });

    switch (result.status) {
      case "unauthorized":
        return NextResponse.json(
          { error: { code: "unauthorized", message: "Your session has expired. Please sign in again." }, correlationId },
          { status: 401 },
        );
      case "forbidden":
        return NextResponse.json(
          { error: { code: "forbidden", message: "Only the business owner can resend invitations." }, correlationId },
          { status: 403 },
        );
      case "rate_limited":
        return NextResponse.json(
          { error: { code: "rate_limited", message: "Too many resend requests. Try again later." }, correlationId },
          { status: 429 },
        );
      case "not_found":
        return NextResponse.json(
          { error: { code: "not_found", message: "That invitation could not be found." }, correlationId },
          { status: 404 },
        );
      case "invalid_state":
        return NextResponse.json(
          { error: { code: "invalid_state", message: "This invitation can no longer be resent." }, correlationId },
          { status: 409 },
        );
      case "cooldown":
        return NextResponse.json(
          {
            error: {
              code: "resend_cooldown",
              message: "Please wait before resending this invitation.",
              retryAfterSeconds: result.retryAfterSeconds,
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
            ...(result.devInviteLink ? { devInviteLink: result.devInviteLink } : {}),
            correlationId,
          },
          { status: 200 },
        );
    }
  } catch (err) {
    console.error("[invitations] resend failed", { correlationId, err });
    return NextResponse.json(
      { error: { code: "service_unavailable", message: "Team management is temporarily unavailable. Please try again shortly." }, correlationId },
      { status: 503 },
    );
  }
}
