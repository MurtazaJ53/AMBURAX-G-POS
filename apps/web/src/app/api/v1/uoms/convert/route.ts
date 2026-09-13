import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { resolveConversion } from "@/server/uom/uomService";

export const runtime = "nodejs";

const convertSchema = z.object({
  quantity: z.number().int(),
  fromUomId: z.string().min(1),
  toUomId: z.string().min(1),
});

/**
 * Resolve a conversion. POST rather than GET because it takes a body, not because it changes
 * anything — nothing is written here.
 *
 * A quantity that does not divide evenly is refused with `not_exact` and the remainder, never
 * rounded. See docs/architecture/UOM.md for why that is the contract.
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

  const parsed = convertSchema.safeParse(body);
  if (!parsed.success) {
    return apiError({
      code: "validation_error",
      message: parsed.error.issues[0]?.message ?? "Check the details and try again.",
      status: 400,
      correlationId,
    });
  }

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const result = await resolveConversion({
      tenantId: resolved.context.tenantId,
      quantity: parsed.data.quantity,
      fromUomId: parsed.data.fromUomId,
      toUomId: parsed.data.toUomId,
    });

    switch (result.status) {
      case "ok":
        return NextResponse.json(
          {
            status: "ok",
            quantity: result.quantity,
            fromCode: result.fromCode,
            toCode: result.toCode,
            correlationId,
          },
          { status: 200 },
        );
      case "not_found":
        return apiError({
          code: "not_found",
          message: "That unit could not be found.",
          status: 404,
          correlationId,
        });
      case "not_exact":
        return apiError({
          code: "not_exact",
          message: `That quantity does not convert evenly: ${result.remainder} ${result.inUnitCode} would be left over.`,
          status: 422,
          correlationId,
        });
      case "no_conversion_path":
        return apiError({
          code: "no_conversion_path",
          message: "No conversion is defined between those units.",
          status: 422,
          correlationId,
        });
      case "decimal_uom_unsupported":
        return apiError({
          code: "decimal_uom_unsupported",
          message: `${result.uomCode} allows decimals, and quantities are whole numbers in this system.`,
          status: 422,
          correlationId,
        });
      default:
        return apiError({
          code: "validation_error",
          message: "Enter a valid whole quantity.",
          status: 400,
          correlationId,
        });
    }
  } catch (err) {
    logError("uom: convert failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Conversion is temporarily unavailable.");
  }
}
