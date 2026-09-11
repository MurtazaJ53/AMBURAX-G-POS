import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { resolveSession } from "@/server/identity/session";
import { getOnboardingReadiness } from "@/server/onboarding/readiness";
import { env } from "@/lib/env";

export const runtime = "nodejs";

/**
 * A10's status read. Tenant is resolved from the session cookie — there is deliberately no
 * `tenantId` query parameter, so one tenant can never read another's setup state.
 *
 * Owner-only: this exposes tenant-wide configuration progress (team size, terminal states,
 * what is unconfigured), which is the business owner's operational picture rather than
 * something a cashier needs. Widening it later is a deliberate decision, not a default.
 *
 * The payload carries display names and derived levels only. No store ids, device ids, user
 * ids, pairing codes or ERPNext identifiers cross this boundary.
 */
export async function GET(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in required." }, correlationId },
      { status: 401 },
    );
  }

  try {
    const session = await resolveSession(sessionToken);
    if (!session) {
      return NextResponse.json(
        { error: { code: "unauthorized", message: "Your session has expired. Please sign in again." }, correlationId },
        { status: 401 },
      );
    }

    if (session.user.tenantRole !== "OWNER") {
      return NextResponse.json(
        { error: { code: "forbidden", message: "Only the business owner can view setup status." }, correlationId },
        { status: 403 },
      );
    }

    const result = await getOnboardingReadiness({
      tenantId: session.tenantId,
      userId: session.userId,
    });

    switch (result.status) {
      case "unauthorized":
        return NextResponse.json(
          { error: { code: "unauthorized", message: "Your session has expired. Please sign in again." }, correlationId },
          { status: 401 },
        );

      case "forbidden":
        return NextResponse.json(
          { error: { code: "forbidden", message: "Only the business owner can view setup status." }, correlationId },
          { status: 403 },
        );

      case "inconsistent":
        // Surfaced as a real error rather than an almost-complete checklist: a tenant past
        // the store step with no store is corrupt data, and reporting it as "not configured
        // yet" would hide a bug behind a to-do item.
        return NextResponse.json(
          {
            error: {
              code: "inconsistent_state",
              message: "Your setup is in an unexpected state. Please contact support.",
              reason: result.reason,
            },
            correlationId,
          },
          { status: 409 },
        );

      case "ok":
        return NextResponse.json({ status: "ok", readiness: result.readiness, correlationId }, { status: 200 });
    }
  } catch (err) {
    console.error("[onboarding/status] readiness read failed", { correlationId, err });
    return NextResponse.json(
      {
        error: {
          code: "service_unavailable",
          message: "Setup status is temporarily unavailable. Please try again shortly.",
        },
        correlationId,
      },
      { status: 503 },
    );
  }
}
