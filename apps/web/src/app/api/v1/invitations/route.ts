import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createInvitation, listInvitations } from "@/server/tenant/invitation";
import { clientIp } from "@/lib/request";
import { env } from "@/lib/env";

export const runtime = "nodejs";

const bodySchema = z.object({
  storeId: z.string().min(1).max(100),
  email: z.string().trim().email().max(255),
  role: z.string().min(1).max(50),
});

function requireSession(req: NextRequest): string | null {
  return req.cookies.get(env.SESSION_COOKIE_NAME)?.value ?? null;
}

export async function GET(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = requireSession(req);
  if (!sessionToken) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Sign in required." }, correlationId }, { status: 401 });
  }

  try {
    const result = await listInvitations({ sessionToken });
    switch (result.status) {
      case "unauthorized":
        return NextResponse.json(
          { error: { code: "unauthorized", message: "Your session has expired. Please sign in again." }, correlationId },
          { status: 401 },
        );
      case "forbidden":
        return NextResponse.json(
          { error: { code: "forbidden", message: "Only the business owner can view invitations." }, correlationId },
          { status: 403 },
        );
      case "ok":
        return NextResponse.json({ status: "ok", invitations: result.invitations, correlationId }, { status: 200 });
    }
  } catch (err) {
    console.error("[invitations] list failed", { correlationId, err });
    return NextResponse.json(
      { error: { code: "service_unavailable", message: "Team management is temporarily unavailable. Please try again shortly." }, correlationId },
      { status: 503 },
    );
  }
}

// Tenant identity is never accepted from the client — resolved from the session cookie.
// `storeId` IS client-supplied but is authorization-checked server-side against the
// caller's own tenant before use (see invitation.ts).
export async function POST(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = requireSession(req);
  if (!sessionToken) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Sign in required." }, correlationId }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_request", message: "Malformed request body." }, correlationId }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Check the form and try again." }, correlationId },
      { status: 400 },
    );
  }

  try {
    const result = await createInvitation({
      sessionToken,
      storeId: parsed.data.storeId,
      email: parsed.data.email,
      role: parsed.data.role,
      ip: clientIp(req),
      correlationId,
    });

    switch (result.status) {
      case "unauthorized":
        return NextResponse.json(
          { error: { code: "unauthorized", message: "Your session has expired. Please sign in again." }, correlationId },
          { status: 401 },
        );
      case "forbidden":
        return NextResponse.json(
          { error: { code: "forbidden", message: "Only the business owner can invite team members." }, correlationId },
          { status: 403 },
        );
      case "rate_limited":
        return NextResponse.json(
          { error: { code: "rate_limited", message: "Too many invitations sent. Try again later." }, correlationId },
          { status: 429 },
        );
      case "invalid_role":
        return NextResponse.json(
          { error: { code: "invalid_role", message: "Choose a valid team role." }, correlationId },
          { status: 400 },
        );
      case "invalid_store":
        return NextResponse.json(
          { error: { code: "invalid_store", message: "That store could not be found." }, correlationId },
          { status: 400 },
        );
      case "email_unavailable":
        return NextResponse.json(
          { error: { code: "email_unavailable", message: "This email can't be invited to your business." }, correlationId },
          { status: 409 },
        );
      case "already_member":
        return NextResponse.json(
          { error: { code: "already_member", message: "This person already has access to that store." }, correlationId },
          { status: 409 },
        );
      case "ok":
        return NextResponse.json(
          {
            status: "ok",
            invitation: result.invitation,
            ...(result.devInviteLink ? { devInviteLink: result.devInviteLink } : {}),
            correlationId,
          },
          { status: 201 },
        );
    }
  } catch (err) {
    console.error("[invitations] create failed", { correlationId, err });
    return NextResponse.json(
      { error: { code: "service_unavailable", message: "Team management is temporarily unavailable. Please try again shortly." }, correlationId },
      { status: 503 },
    );
  }
}
