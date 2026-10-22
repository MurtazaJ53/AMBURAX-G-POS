import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { getProgram, balance } from "@/server/loyalty/loyalty";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  const { id: customerId } = await params;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const program = await getProgram(resolved.context.tenantId, "INR");
    if (!program) {
      return NextResponse.json({
        status: "ok",
        availablePoints: 0,
        pendingPoints: 0,
        pointValueMinor: 100, // 1 point = ₹1
        minRedeemPoints: 100,
        programEnabled: false,
      });
    }

    const bal = await balance({
      tenantId: resolved.context.tenantId,
      customerId,
      programId: program.id,
    });

    return NextResponse.json({
      status: "ok",
      availablePoints: bal.available,
      pendingPoints: bal.pending,
      pointValueMinor: program.pointValueMinor,
      minRedeemPoints: program.minRedeemPoints,
      programEnabled: program.enabled,
    });
  } catch (err) {
    logError("loyalty balance lookup failed", err, { correlationId, customerId });
    return NextResponse.json({
      status: "ok",
      availablePoints: 0,
      pendingPoints: 0,
      pointValueMinor: 100,
      minRedeemPoints: 100,
      programEnabled: false,
    });
  }
}
