import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { completeTeamStep } from "@/server/tenant/teamStep";
import { clientIp } from "@/lib/request";
import { env } from "@/lib/env";

export const runtime = "nodejs";

// Called by both "Skip" and "Continue" on A8 — creating an invitation never itself
// advances onboarding (see teamStep.ts). No body: nothing here is client-suppliable.
export async function POST(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Sign in required." }, correlationId }, { status: 401 });
  }

  try {
    const result = await completeTeamStep({ sessionToken, ip: clientIp(req), correlationId });

    switch (result.status) {
      case "unauthorized":
        return NextResponse.json(
          { error: { code: "unauthorized", message: "Your session has expired. Please sign in again." }, correlationId },
          { status: 401 },
        );
      case "forbidden":
        return NextResponse.json(
          { error: { code: "forbidden", message: "Only the business owner can complete this step." }, correlationId },
          { status: 403 },
        );
      case "rate_limited":
        return NextResponse.json(
          { error: { code: "rate_limited", message: "Too many attempts. Try again later." }, correlationId },
          { status: 429 },
        );
      case "already_completed":
        return NextResponse.json(
          { error: { code: "already_completed", message: "Team setup is already complete." }, correlationId },
          { status: 409 },
        );
      case "ok":
        return NextResponse.json({ status: "ok", correlationId }, { status: 200 });
    }
  } catch (err) {
    console.error("[onboarding/team/complete] failed", { correlationId, err });
    return NextResponse.json(
      { error: { code: "service_unavailable", message: "Please try again shortly." }, correlationId },
      { status: 503 },
    );
  }
}
