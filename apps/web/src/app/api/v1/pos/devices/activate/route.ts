import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { activatePosDevice } from "@/server/pos/posDeviceActivation";
import { clientIp } from "@/lib/request";

export const runtime = "nodejs";

// Deliberately takes no session cookie and no user identity. The caller is a terminal, not
// a person; the pairing code is the whole credential. Same posture as A11's public accept
// endpoint: possession authorizes exactly one narrow action and nothing else.
const bodySchema = z.object({
  // Length is bounded but the format is not over-constrained here — normalization
  // (case, separators) happens in the service so one implementation owns it.
  pairingCode: z.string().trim().min(8).max(64),
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
      { error: { code: "validation_error", message: "Enter the pairing code from POS setup." }, correlationId },
      { status: 400 },
    );
  }

  try {
    const result = await activatePosDevice({
      pairingCode: parsed.data.pairingCode,
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
          { error: { code: "invalid_pairing_code", message: "That pairing code isn't valid. Generate a new one from POS setup." }, correlationId },
          { status: 400 },
        );

      case "expired":
        return NextResponse.json(
          { error: { code: "pairing_code_expired", message: "That pairing code has expired. Generate a new one from POS setup." }, correlationId },
          { status: 410 },
        );

      case "already_activated":
        return NextResponse.json(
          { error: { code: "already_activated", message: "This terminal has already been paired." }, correlationId },
          { status: 409 },
        );

      case "disabled":
        return NextResponse.json(
          { error: { code: "device_disabled", message: "This terminal has been disabled." }, correlationId },
          { status: 403 },
        );

      case "ok":
        // The device secret is returned exactly once, in the body, to the machine that
        // just proved possession of the pairing code. It is never set as a cookie (this
        // is not a browser session) and never logged.
        return NextResponse.json(
          { status: "ok", device: result.device, deviceSecret: result.deviceSecret, correlationId },
          { status: 200 },
        );
    }
  } catch (err) {
    console.error("[pos/devices/activate] activation failed", { correlationId, err });
    return NextResponse.json(
      {
        error: {
          code: "service_unavailable",
          message: "Pairing is temporarily unavailable. Please try again shortly.",
        },
        correlationId,
      },
      { status: 503 },
    );
  }
}
