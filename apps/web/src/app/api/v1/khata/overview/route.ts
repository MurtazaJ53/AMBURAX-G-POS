import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { unauthorized, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { ErpKhataService } from "@/server/khata/khataService";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") {
      const { noStore } = await import("@/lib/apiError");
      return noStore(correlationId);
    }

    const khataService = new ErpKhataService();
    const overview = await khataService.getKhataOverview({
      tenantId: resolved.context.tenantId,
      correlationId,
    });

    return NextResponse.json({ status: "ok", overview, correlationId }, { status: 200 });
  } catch (err) {
    logError("khata: overview failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Khata overview is temporarily unavailable.");
  }
}
