import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { isCapability } from "@/server/capability/capabilities";
import { setCapability } from "@/server/capability/capabilityService";

export const runtime = "nodejs";

const bodySchema = z.object({ enabled: z.boolean() });

/**
 * Switch one capability on or off for the caller's own tenant.
 *
 * Tenant OWNER only. A capability is company-wide configuration — switching WHOLESALE on
 * changes what the business is, not what one store does — so the authority is the tenant-wide
 * role rather than any store membership. STAFF are refused whatever their store role.
 *
 * The tenant is the session's. There is no tenant in the URL or the body, so this endpoint
 * cannot be aimed at another tenant's configuration even by an owner.
 *
 * The capability name is validated against the enum before it reaches the service. An unknown
 * identifier is a 404 on the URL, not a silent no-op — a typo'd capability must not look like a
 * successful change.
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ capability: string }> }) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  const { capability } = await ctx.params;

  if (!isCapability(capability)) {
    return apiError({ code: "not_found", message: "Not found.", status: 404, correlationId });
  }

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

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "validation_error",
      message: "Say whether the capability should be enabled.",
      status: 400,
      correlationId,
    });
  }

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const result = await setCapability({
      actor: {
        tenantId: resolved.context.tenantId,
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
      },
      capability,
      enabled: parsed.data.enabled,
      correlationId,
    });

    if (result.status === "forbidden") {
      return forbidden(correlationId, "Only the business owner can change capabilities.");
    }

    return NextResponse.json(
      {
        status: "ok",
        capability: result.capability,
        enabled: result.enabled,
        changed: result.changed,
        correlationId,
      },
      { status: 200 },
    );
  } catch (err) {
    logError("capabilities: set failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Changing a capability is temporarily unavailable.");
  }
}
