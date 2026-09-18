import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { createProduct } from "@/server/catalog/catalogService";

export const runtime = "nodejs";

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  category: z.string().trim().max(100).nullable().optional(),
  brand: z.string().trim().max(100).nullable().optional(),
  isActive: z.boolean().default(true),
  baseUomId: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

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

    const result = await createProduct({
      actor: {
        tenantId: resolved.context.tenantId,
        userId: resolved.context.userId,
        tenantRole: resolved.context.tenantRole,
      },
      name: parsed.data.name,
      category: parsed.data.category ?? null,
      brand: parsed.data.brand ?? null,
      isActive: parsed.data.isActive,
      baseUomId: parsed.data.baseUomId ?? null,
      correlationId,
    });

    if (result.status === "forbidden") {
      return forbidden(correlationId, "You do not have permission to manage the catalogue.");
    }
    if (result.status === "not_found") {
      return apiError({ code: "not_found", message: "UOM not found.", status: 404, correlationId });
    }
    if (result.status === "conflict") {
      return apiError({ code: "conflict", message: "Conflict.", status: 409, correlationId });
    }

    if (result.status === "ok") { return NextResponse.json({ status: "ok", productId: result.productId, correlationId }, { status: 201 }); } else { return apiError({ code: "error", message: "Error", status: 400, correlationId }); }
  } catch (err) {
    logError("catalog: create product failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Temporarily unavailable.");
  }
}

