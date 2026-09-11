import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { completePosStep, createFirstPosDevice } from "@/server/pos/posDeviceSetup";
import { clientIp } from "@/lib/request";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";

export const runtime = "nodejs";

// Two shapes on one endpoint because the A9 wireframe has two buttons and both complete
// the same onboarding step. Discriminated on `skip` so neither shape can be half-supplied:
// a "skip" body carrying device fields, or a device body missing them, fails validation
// rather than being silently coerced into the other path.
const skipSchema = z.object({ skip: z.literal(true) });

const deviceSchema = z.object({
  skip: z.literal(false).optional(),
  storeId: z.string().min(1).max(64),
  name: z.string().trim().min(2).max(100),
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{2,20}$/, "Use 2-20 letters, numbers or hyphens, e.g. POS-01."),
  receiptHeader: z.string().trim().max(200).optional(),
  receiptFooter: z.string().trim().max(200).optional(),
  showProductImages: z.boolean(),
  scanSoundEnabled: z.boolean(),
  cashDrawerEnabled: z.boolean(),
});

const bodySchema = z.union([skipSchema, deviceSchema]);

// No tenantId/ownerId is accepted from the client — both are resolved from the session
// cookie inside the service. `storeId` IS accepted, because a tenant may legitimately have
// several stores, but it is validated against the caller's own tenant and store membership
// server-side before anything is written.
export async function POST(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  if (!sessionToken) {
    return NextResponse.json(
      { error: { code: "unauthorized", message: "Sign in required." }, correlationId },
      { status: 401 },
    );
  }

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
    const first = parsed.error.issues[0];
    return NextResponse.json(
      {
        error: { code: "validation_error", message: first?.message ?? "Check the form and try again." },
        correlationId,
      },
      { status: 400 },
    );
  }

  const ip = clientIp(req);

  try {
    if ("skip" in parsed.data && parsed.data.skip === true) {
      const result = await completePosStep({ sessionToken, ip, correlationId });

      switch (result.status) {
        case "unauthorized":
          return NextResponse.json(
            { error: { code: "unauthorized", message: "Your session has expired. Please sign in again." }, correlationId },
            { status: 401 },
          );
        case "forbidden":
          return NextResponse.json(
            { error: { code: "forbidden", message: "Only the business owner can skip POS setup." }, correlationId },
            { status: 403 },
          );
        case "rate_limited":
          return NextResponse.json(
            { error: { code: "rate_limited", message: "Too many attempts. Try again later." }, correlationId },
            { status: 429 },
          );
        case "already_completed":
          return NextResponse.json(
            { error: { code: "already_completed", message: "POS setup for this business is already complete." }, correlationId },
            { status: 409 },
          );
        case "ok":
          return NextResponse.json({ status: "ok", skipped: true, correlationId }, { status: 200 });
      }
    }

    const device = parsed.data as z.infer<typeof deviceSchema>;
    const result = await createFirstPosDevice({
      sessionToken,
      storeId: device.storeId,
      name: device.name,
      code: device.code,
      receiptHeader: device.receiptHeader,
      receiptFooter: device.receiptFooter,
      showProductImages: device.showProductImages,
      scanSoundEnabled: device.scanSoundEnabled,
      cashDrawerEnabled: device.cashDrawerEnabled,
      ip,
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
          {
            error: {
              code: "forbidden",
              message: "You don't have permission to set up a POS terminal for this store.",
            },
            correlationId,
          },
          { status: 403 },
        );

      case "rate_limited":
        return NextResponse.json(
          { error: { code: "rate_limited", message: "Too many attempts. Try again later." }, correlationId },
          { status: 429 },
        );

      case "store_not_found":
        // Deliberately the same message a genuinely unknown store gets: a store in another
        // tenant must not be distinguishable from one that doesn't exist.
        return NextResponse.json(
          { error: { code: "store_not_found", message: "That store could not be found." }, correlationId },
          { status: 404 },
        );

      case "wrong_step":
        return NextResponse.json(
          { error: { code: "already_completed", message: "POS setup for this business is already complete." }, correlationId },
          { status: 409 },
        );

      case "device_conflict":
        return NextResponse.json(
          { error: { code: "device_conflict", message: "A terminal with that code already exists in this store." }, correlationId },
          { status: 409 },
        );

      case "ok":
        // `pairingCode` is in the response body only — never a header, never a cookie,
        // never logged. It is shown once and cannot be retrieved again.
        return NextResponse.json(
          {
            status: "ok",
            device: result.device,
            pairingCode: result.pairingCode,
            pairingExpiresAt: result.pairingExpiresAt,
            correlationId,
          },
          { status: 201 },
        );
    }
  } catch (err) {
    logError("onboarding/pos: POS setup failed", err, { correlationId });
    return NextResponse.json(
      {
        error: {
          code: "service_unavailable",
          message: "POS setup is temporarily unavailable. Please try again shortly.",
        },
        correlationId,
      },
      { status: 503 },
    );
  }
}
