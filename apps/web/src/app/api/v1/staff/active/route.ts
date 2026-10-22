import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, forbidden, noStore } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { db } from "@/server/db";

export const runtime = "nodejs";

/**
 * Return staff members eligible for commission / salesperson attribution in the current store.
 */
export async function GET(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const members = await db.storeMembership.findMany({
      where: {
        tenantId: resolved.context.tenantId,
        storeId: resolved.context.storeId,
        user: { status: "ACTIVE" },
      },
      select: {
        role: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { user: { name: "asc" } },
    });

    const staff = members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
    }));

    return NextResponse.json({ staff, correlationId });
  } catch (err) {
    logError("staff: lookup failed", err, { correlationId });
    return apiError({
      code: "internal_error",
      message: "Could not load sales staff.",
      status: 500,
      correlationId,
    });
  }
}
