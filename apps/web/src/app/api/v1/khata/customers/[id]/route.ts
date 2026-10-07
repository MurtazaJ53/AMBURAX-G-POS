import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { ErpKhataService } from "@/server/khata/khataService";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  const { id: customerId } = await context.params;

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") {
      const { noStore } = await import("@/lib/apiError");
      return noStore(correlationId);
    }

    const khataService = new ErpKhataService();
    const receivables = await khataService.getCustomerReceivables({
      tenantId: resolved.context.tenantId,
      customerId,
      correlationId,
    });

    return NextResponse.json({ status: "ok", receivables, correlationId }, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("not found")) {
      return apiError({
        code: "not_found",
        message: err.message,
        status: 404,
        correlationId,
      });
    }
    logError("khata: customer receivables failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Customer receivables temporarily unavailable.");
  }
}
