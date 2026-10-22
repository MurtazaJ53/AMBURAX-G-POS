import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { punch } from "@/server/staff/attendance";
import { db } from "@/server/db";
import { istDay } from "@/server/pos/cashRegister";

export const runtime = "nodejs";

/**
 * GET: Current user attendance status for the current store today.
 * POST: Quick punch IN or OUT.
 */
export async function GET(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const { context } = resolved;
    const now = new Date();
    const { from } = istDay(new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10));

    const lastPunch = await db.staffCheckin.findFirst({
      where: {
        tenantId: context.tenantId,
        storeId: context.storeId,
        userId: context.userId,
        at: { gte: from },
        voidedByCorrectionId: null,
      },
      orderBy: { at: "desc" },
      select: { logType: true, at: true },
    });

    const isClockedIn = lastPunch?.logType === "IN";

    return NextResponse.json({
      clockedIn: isClockedIn,
      lastPunchAt: lastPunch?.at ? lastPunch.at.toISOString() : null,
      userName: context.userName,
      storeName: context.storeName,
      correlationId,
    });
  } catch (err) {
    logError("staff attendance status failed", err, { correlationId });
    return apiError({
      code: "internal_error",
      message: "Could not fetch attendance status.",
      status: 500,
      correlationId,
    });
  }
}

export async function POST(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const { context } = resolved;
    const body = await req.json().catch(() => ({}));
    const logType = body.logType === "OUT" ? "OUT" : "IN";

    const res = await punch({
      actor: { tenantId: context.tenantId, userId: context.userId, tenantRole: context.tenantRole },
      storeId: context.storeId,
      logType,
    });

    if (res.status === "forbidden") {
      return apiError({
        code: "forbidden",
        message: "You are not assigned to this store.",
        status: 403,
        correlationId,
      });
    }

    if (res.status === "conflict") {
      return apiError({
        code: "conflict",
        message: res.reason,
        status: 409,
        correlationId,
      });
    }

    return NextResponse.json({
      ok: true,
      logType,
      clockedIn: logType === "IN",
      message: logType === "IN" ? "Successfully clocked in." : "Successfully clocked out.",
      correlationId,
    });
  } catch (err) {
    logError("staff attendance punch failed", err, { correlationId });
    return apiError({
      code: "internal_error",
      message: "Could not record punch.",
      status: 500,
      correlationId,
    });
  }
}
