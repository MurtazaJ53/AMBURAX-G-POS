import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { apiError, unauthorized, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { db } from "@/server/db";
import { logError } from "@/lib/safeLog";

export const runtime = "nodejs";

/**
 * GET /api/v1/catalog/attributes
 * Returns all attribute definitions (with their active values and hex swatches) for the authenticated tenant.
 */
export async function GET(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);

    const tenantId = resolved.context.tenantId;

    const definitions = await db.attributeDefinition.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        values: {
          where: { isActive: true },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          select: {
            id: true,
            value: true,
            code: true,
            colorHex: true,
            sortOrder: true,
          },
        },
      },
    });

    return NextResponse.json({ status: "ok", definitions });
  } catch (err) {
    logError("catalog: get attributes failed", err);
    return serviceUnavailable(correlationId, "Could not load attribute masters.");
  }
}
