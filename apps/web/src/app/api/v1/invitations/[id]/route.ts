import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { revokeInvitation } from "@/server/tenant/invitation";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";

export const runtime = "nodejs";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Sign in required." }, correlationId }, { status: 401 });
  }

  const { id } = await params;

  try {
    const result = await revokeInvitation({ sessionToken, invitationId: id, correlationId });

    switch (result.status) {
      case "unauthorized":
        return NextResponse.json(
          { error: { code: "unauthorized", message: "Your session has expired. Please sign in again." }, correlationId },
          { status: 401 },
        );
      case "forbidden":
        return NextResponse.json(
          { error: { code: "forbidden", message: "Only the business owner can revoke invitations." }, correlationId },
          { status: 403 },
        );
      case "not_found":
        return NextResponse.json(
          { error: { code: "not_found", message: "That invitation could not be found." }, correlationId },
          { status: 404 },
        );
      case "already_accepted":
        return NextResponse.json(
          { error: { code: "already_accepted", message: "This invitation was already accepted and can't be revoked." }, correlationId },
          { status: 409 },
        );
      case "ok":
        return NextResponse.json({ status: "ok", correlationId }, { status: 200 });
    }
  } catch (err) {
    logError("invitations: revoke failed", err, { correlationId });
    return NextResponse.json(
      { error: { code: "service_unavailable", message: "Team management is temporarily unavailable. Please try again shortly." }, correlationId },
      { status: 503 },
    );
  }
}
