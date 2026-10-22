import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { apiError, unauthorized, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { db } from "@/server/db";
import { logError } from "@/lib/safeLog";

export const runtime = "nodejs";

/**
 * GET /api/v1/catalog/size-groups
 * Returns all size groups and their ordered sizes for the authenticated tenant.
 */
export async function GET(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);

    const tenantId = resolved.context.tenantId;

    const sizeGroups = await db.sizeGroup.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        items: {
          orderBy: { sortOrder: "asc" },
          include: {
            value: {
              select: {
                id: true,
                value: true,
                code: true,
                isActive: true,
              },
            },
          },
        },
      },
    });

    const formatted = sizeGroups.map((g) => ({
      id: g.id,
      name: g.name,
      code: g.code,
      sizes: g.items
        .filter((item) => item.value.isActive)
        .map((item) => ({
          id: item.value.id,
          name: item.value.value,
          code: item.value.code,
        })),
    }));

    return NextResponse.json({ status: "ok", sizeGroups: formatted });
  } catch (err) {
    logError("catalog: get size-groups failed", err);
    return serviceUnavailable(correlationId, "Could not load size groups.");
  }
}
