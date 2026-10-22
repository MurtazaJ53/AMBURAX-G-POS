import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolvePosContext } from "@/server/sales/posContext";
import { backgroundSyncStatus, getSystemHealth } from "@/server/ops/operations";
import { unauthorized, serviceUnavailable } from "@/lib/apiError";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  if (resolved.status !== "ok") {
    return unauthorized("live-sync-status");
  }

  const { tenantId } = resolved.context;
  try {
    const running = backgroundSyncStatus(tenantId);
    const health = await getSystemHealth({ tenantId });
    const pending = health.types.reduce((s, t) => s + t.pending, 0);
    const failed = health.types.reduce((s, t) => s + t.failed, 0);

    return NextResponse.json({
      status: "ok",
      running,
      pending,
      failed,
      types: health.types,
      oldestPendingAt: health.oldestPendingAt,
    });
  } catch {
    return serviceUnavailable("live-sync-status", "Could not check sync status");
  }
}
