import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { assignProductBaseUom } from "@/server/uom/uomService";

export const runtime = "nodejs";

const assignSchema = z.object({ uomId: z.string().min(1) });

/**
 * Set the unit a product's quantities are counted in.
 *
 * Deliberately the only product-facing endpoint in this phase: there is still no product CRUD
 * API, and adding one here would be building the catalogue phase early. This exists because a
 * base unit is the one product field the UOM foundation owns.
 */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  const { id } = await ctx.params;

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

  const parsed = assignSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Choose a unit.",
      status: 400,
      correlationId,
    });
  }

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const result = await assignProductBaseUom({
      actor: {
        tenantId: resolved.context.tenantId,
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
        membershipRole: resolved.context.membershipRole,
      },
      productId: id,
      uomId: parsed.data.uomId,
      correlationId,
    });

    if (result.status === "forbidden") {
      return forbidden(correlationId, "You do not have permission to manage units.");
    }
    if (result.status === "not_found") {
      // Same answer for another tenant's product and a nonexistent one.
      return apiError({
        code: "not_found",
        message: "That product or unit could not be found.",
        status: 404,
        correlationId,
      });
    }
    if (result.status === "validation_error" || result.status === "conflict") {
      return apiError({
        code: result.status === "conflict" ? "conflict" : "validation_error",
        message: result.reason,
        status: result.status === "conflict" ? 409 : 400,
        correlationId,
      });
    }

    return NextResponse.json(
      { status: "ok", productId: result.productId, baseUomId: result.baseUomId, correlationId },
      { status: 200 },
    );
  } catch (err) {
    logError("uom: base unit assignment failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Setting the unit is temporarily unavailable.");
  }
}
