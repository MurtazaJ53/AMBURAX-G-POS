import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { completeOnboarding } from "@/server/onboarding/completeOnboarding";
import { clientIp } from "@/lib/request";
import { env } from "@/lib/env";

export const runtime = "nodejs";

/**
 * A10's completion transition. Takes no request body at all: there is nothing for a client
 * to supply that the server would trust. Tenant, role and current onboarding step are all
 * resolved server-side, and the transition is refused unless the tenant is genuinely at
 * POS_CONFIGURED — a client cannot name a target step, skip ahead, or roll one back.
 *
 * Distinct from `POST /api/v1/onboarding/team/complete`, which owns A8's earlier
 * STORE_CREATED -> TEAM_INVITED transition. Same naming shape, different step, no shared
 * state.
 */
export async function POST(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in required." }, correlationId },
      { status: 401 },
    );
  }

  try {
    const result = await completeOnboarding({
      sessionToken,
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
          { error: { code: "forbidden", message: "Only the business owner can finish setup." }, correlationId },
          { status: 403 },
        );

      case "rate_limited":
        return NextResponse.json(
          { error: { code: "rate_limited", message: "Too many attempts. Try again later." }, correlationId },
          { status: 429 },
        );

      case "wrong_step":
        return NextResponse.json(
          {
            error: {
              code: "wrong_step",
              message: "There are still setup steps to finish before you can complete onboarding.",
              onboardingStep: result.onboardingStep,
            },
            correlationId,
          },
          { status: 409 },
        );

      case "already_complete":
        // 200, not an error: a refresh or a second tab is normal use, and the caller gets
        // the same authoritative readiness payload the winner got. Idempotent by design.
        return NextResponse.json(
          { status: "already_complete", readiness: result.readiness, correlationId },
          { status: 200 },
        );

      case "ok":
        return NextResponse.json(
          { status: "ok", readiness: result.readiness, correlationId },
          { status: 200 },
        );
    }
  } catch (err) {
    console.error("[onboarding/complete] completion failed", { correlationId, err });
    return NextResponse.json(
      {
        error: {
          code: "service_unavailable",
          message: "We couldn't finish setup right now. Please try again shortly.",
        },
        correlationId,
      },
      { status: 503 },
    );
  }
}
