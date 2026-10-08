import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolvePosContext } from "@/server/sales/posContext";
import { createHeldBill, listHeldBills } from "@/server/sales/heldBillService";
import { apiError, forbidden, noStore, unauthorized } from "@/lib/apiError";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";

const createHeldBillSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(200),
  posSessionId: z.string().trim().min(1).nullish(),
  items: z.array(z.object({
    variantId: z.string().trim().min(1),
    quantity: z.number().int().min(1),
  })).min(1, "Cannot hold an empty bill"),
});

export async function POST(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);
    if (!resolved.context.canSell) return forbidden(correlationId, "Not allowed to hold bills.");

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return apiError({ code: "invalid_request", message: "Malformed request.", status: 400, correlationId });
    }

    const parsed = createHeldBillSchema.safeParse(body);
    if (!parsed.success) {
      return apiError({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid items", status: 400, correlationId });
    }

    const result = await createHeldBill({
      tenantId: resolved.context.tenantId,
      storeId: resolved.context.storeId,
      heldByUserId: resolved.context.userId,
      posSessionId: parsed.data.posSessionId ?? null,
      idempotencyKey: parsed.data.idempotencyKey,
      items: parsed.data.items,
    });

    return NextResponse.json({ status: "ok", heldBill: result.heldBill, duplicate: result.duplicate, correlationId });
  } catch (err: any) {
    console.error("Failed to create held bill:", err);
    return apiError({ code: "server_error", message: err.message || "Failed to hold bill.", status: 500, correlationId });
  }
}

export async function GET(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);
    if (!resolved.context.canSell) return forbidden(correlationId, "Not allowed to list held bills.");

    const page = parseInt(req.nextUrl.searchParams.get("page") ?? "1", 10);
    
    const bills = await listHeldBills({
      tenantId: resolved.context.tenantId,
      storeId: resolved.context.storeId,
      page: isNaN(page) || page < 1 ? 1 : page,
    });

    return NextResponse.json({ status: "ok", heldBills: bills, correlationId });
  } catch (err: any) {
    console.error("Failed to list held bills:", err);
    return apiError({ code: "server_error", message: err.message || "Failed to list held bills.", status: 500, correlationId });
  }
}
