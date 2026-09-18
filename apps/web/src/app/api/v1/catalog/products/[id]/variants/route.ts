import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { createVariant } from "@/server/catalog/catalogService";

export const runtime = "nodejs";

const schema = z.object({
  sku: z.string().trim().min(1, "SKU is required").max(100),
  barcode: z.string().trim().max(100).nullable().optional(),
  size: z.string().trim().max(50).nullable().optional(),
  colour: z.string().trim().max(50).nullable().optional(),
  priceMinor: z.number().int().min(0, "Price cannot be negative"),
  mrpMinor: z.number().int().min(0).nullable().optional(),
  isActive: z.boolean().default(true),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError({ code: "invalid_request", message: "Malformed request body.", status: 400, correlationId });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return apiError({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid data.", status: 400, correlationId });
  }

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return apiError({ code: "no_store", message: "No store", status: 400, correlationId });

    const result = await createVariant({
      actor: {
        tenantId: resolved.context.tenantId,
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
      },
      productId: id,
      sku: parsed.data.sku,
      barcode: parsed.data.barcode ?? null,
      size: parsed.data.size ?? null,
      colour: parsed.data.colour ?? null,
      priceMinor: parsed.data.priceMinor,
      mrpMinor: parsed.data.mrpMinor ?? null,
      isActive: parsed.data.isActive,
      correlationId,
    });

    if (result.status === "forbidden") {
      return forbidden(correlationId, "You do not have permission to manage the catalogue.");
    }
    if (result.status === "not_found") {
      return apiError({ code: "not_found", message: "Product not found.", status: 404, correlationId });
    }
    if (result.status === "conflict") {
      return apiError({ code: "conflict", message: "SKU or barcode already exists.", status: 409, correlationId });
    }

    if (result.status === "ok") { return NextResponse.json({ status: "ok", variantId: result.variantId, correlationId }, { status: 201 }); } else { return apiError({ code: "error", message: "Error", status: 400, correlationId }); }
  } catch (err) {
    logError("catalog: create variant failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Temporarily unavailable.");
  }
}

