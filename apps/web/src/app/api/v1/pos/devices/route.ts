import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, noStore, serviceUnavailable } from "@/lib/apiError";
import { z } from "zod";
import { resolvePosContext } from "@/server/sales/posContext";
import { listPosDevices } from "@/server/pos/posDeviceQueries";
import { createPosDevice } from "@/server/pos/posDeviceProvisioning";

export const runtime = "nodejs";

/**
 * The terminals in the caller's own store.
 *
 * There is no tenant or store parameter, and that absence is the isolation guarantee: both are
 * read from the session, so there is nowhere for a client to put another tenant's identifiers.
 *
 * A disabled RETAIL capability answers 404, not 403, per the P1-7 freeze — whether a tenant has
 * a module is not something their API surface volunteers.
 */
export async function GET(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const result = await listPosDevices({
      tenantId: resolved.context.tenantId,
      storeId: resolved.context.storeId,
    });

    if (result.status === "capability_disabled") {
      return apiError({ code: "not_found", message: "Not found.", status: 404, correlationId });
    }

    return NextResponse.json(
      { status: "ok", devices: result.devices, correlationId },
      { status: 200 },
    );
  } catch (err) {
    logError("pos/devices: list failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Terminals are temporarily unavailable.");
  }
}

/**
 * What a client may say when registering a terminal.
 *
 * Note what is absent: **no tenantId and no storeId.** Both are read from the session, so there
 * is nowhere for a caller to name another tenant's business or another store's floor — the same
 * posture the GET above takes. A body carrying either would not be rejected so much as ignored;
 * the schema has no field to put it in.
 */
const createDeviceSchema = z.object({
  // Bounds only — the domain owns the real rules and its messages are the ones a person reads.
  // These exist so a megabyte of text never reaches the service layer.
  name: z
    .string()
    .trim()
    .min(2, "Give the terminal a name of 2 to 60 characters.")
    .max(60, "Give the terminal a name of 2 to 60 characters."),
  code: z
    .string()
    .trim()
    .min(1, "Use a short code of letters, digits and hyphens, such as POS-02.")
    .max(16, "Use a short code of letters, digits and hyphens, such as POS-02."),
  receiptHeader: z.string().trim().max(200).nullish(),
  receiptFooter: z.string().trim().max(200).nullish(),
  showProductImages: z.boolean().optional(),
  scanSoundEnabled: z.boolean().optional(),
  cashDrawerEnabled: z.boolean().optional(),
});

/**
 * Register a terminal in the caller's own store.
 *
 * This is the supported way to add a till after onboarding has finished. The onboarding step
 * still exists and still advances setup; it simply is no longer the only door, because a
 * business that finished setup without a till, or later bought a second one, had no way in.
 *
 * The response carries the terminal and its pairing code. The code is shown **once**, to the
 * person standing at the terminal — it is never stored in plaintext, never logged, and never
 * appears in the domain event. `pairingCodeHash` and `deviceSecretHash` are not selected
 * anywhere on this path, so there is no route by which either could reach a response.
 */
export async function POST(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError({
      code: "invalid_request",
      message: "Malformed request body.",
      status: 400,
      correlationId,
    });
  }

  const parsed = createDeviceSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Check the terminal details and try again.",
      status: 400,
      correlationId,
    });
  }

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const result = await createPosDevice({
      actor: {
        tenantId: resolved.context.tenantId,
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
        membershipRole: resolved.context.membershipRole,
        storeId: resolved.context.storeId,
      },
      name: parsed.data.name,
      code: parsed.data.code,
      receiptHeader: parsed.data.receiptHeader,
      receiptFooter: parsed.data.receiptFooter,
      showProductImages: parsed.data.showProductImages,
      scanSoundEnabled: parsed.data.scanSoundEnabled,
      cashDrawerEnabled: parsed.data.cashDrawerEnabled,
      correlationId,
    });

    switch (result.status) {
      case "forbidden":
        return forbidden(correlationId, "You do not have permission to add a terminal.");

      case "validation_error":
        return apiError({
          code: "validation_error",
          message: result.reason,
          status: 400,
          correlationId,
        });

      case "conflict":
        return apiError({
          code: "conflict",
          message: result.reason,
          status: 409,
          correlationId,
        });

      // A disabled capability answers as an unknown route, per the P1-7 freeze.
      case "capability_disabled":
        return apiError({
          code: "not_found",
          message: "Not found.",
          status: 404,
          correlationId,
        });

      case "ok":
        return NextResponse.json(
          {
            status: "ok",
            device: result.device,
            pairingCode: result.pairingCode,
            pairingExpiresAt: result.pairingExpiresAt.toISOString(),
            correlationId,
          },
          { status: 201 },
        );
    }
  } catch (err) {
    logError("pos devices: create failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Adding a terminal is temporarily unavailable.");
  }
}
