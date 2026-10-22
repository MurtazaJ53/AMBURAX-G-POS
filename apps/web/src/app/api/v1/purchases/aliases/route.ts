import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore, forbidden } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { canManageInventory } from "@/server/inventory/inventoryRoles";
import { learnSupplierAlias } from "@/server/purchasing/billScan";

export const runtime = "nodejs";

const body = z.object({ supplierId: z.string().min(1), billText: z.string().trim().min(1).max(300), variantId: z.string().min(1) }).strict();

/** Remember what this supplier calls one of our products, so the next bill matches itself. */
export async function POST(req: NextRequest) {
  const correlationId = randomUUID();
  try {
    const resolved = await resolvePosContext(req.cookies.get(env.SESSION_COOKIE_NAME)?.value);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);
    const c = resolved.context;
    if (!canManageInventory(c)) return forbidden(correlationId, "Your role can't record purchases.");
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return apiError({ code: "validation_error", status: 400, message: "Bad match.", correlationId });
    await learnSupplierAlias({ tenantId: c.tenantId, ...parsed.data });
    return NextResponse.json({ status: "ok", correlationId });
  } catch (err) {
    logError("purchases/aliases: failed", err, { correlationId });
    return apiError({ code: "internal_error", status: 500, message: "Couldn't remember that match.", correlationId });
  }
}
