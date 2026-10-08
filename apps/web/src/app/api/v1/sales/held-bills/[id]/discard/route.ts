import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolvePosContext } from "@/server/sales/posContext";
import { discardHeldBill } from "@/server/sales/heldBillService";
import { apiError, forbidden, noStore, unauthorized } from "@/lib/apiError";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";

const discardHeldBillSchema = z.object({
  expectedVersion: z.number().int().min(0),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);
    if (!resolved.context.canSell) return forbidden(correlationId, "Not allowed to discard bills.");

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return apiError({ code: "invalid_request", message: "Malformed request.", status: 400, correlationId });
    }

    const parsed = discardHeldBillSchema.safeParse(body);
    if (!parsed.success) {
      return apiError({ code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid request", status: 400, correlationId });
    }

    await discardHeldBill({
      tenantId: resolved.context.tenantId,
      storeId: resolved.context.storeId,
      id,
      discardedByUserId: resolved.context.userId,
      expectedVersion: parsed.data.expectedVersion,
    });

    return NextResponse.json({ status: "ok", correlationId });
  } catch (err: any) {
    console.error("Failed to discard held bill:", err);
    return apiError({ code: "server_error", message: err.message || "Failed to discard bill.", status: 500, correlationId });
  }
}
