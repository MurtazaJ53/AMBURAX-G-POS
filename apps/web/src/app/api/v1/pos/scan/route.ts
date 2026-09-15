import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore, serviceUnavailable } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { scanBarcode } from "@/server/sales/catalog";

export const runtime = "nodejs";

/**
 * The scan path: one barcode, one indexed read.
 *
 * Distinct from catalogue search, which serves a person typing. Tenant and store both come from
 * the resolved session, so a scan can only ever reach this tenant's catalogue and this store's
 * stock figure.
 *
 * An unknown barcode and another tenant's barcode answer identically. A withdrawn item is
 * returned with `isActive: false` rather than hidden, so the till can say why it cannot be sold.
 */
export async function GET(req: NextRequest) {
  const correlationId = req.headers.get("x-correlation-id") ?? randomUUID();
  const sessionToken = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  const barcode = req.nextUrl.searchParams.get("barcode");

  if (!barcode || barcode.trim().length === 0) {
    return apiError({
      code: "validation_error",
      message: "Scan or enter a barcode.",
      status: 400,
      correlationId,
    });
  }

  try {
    const resolved = await resolvePosContext(sessionToken);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const item = await scanBarcode({
      tenantId: resolved.context.tenantId,
      storeId: resolved.context.storeId,
      barcode,
    });

    if (!item) {
      return apiError({
        code: "not_found",
        message: "No item matches that barcode.",
        status: 404,
        correlationId,
      });
    }

    return NextResponse.json({ status: "ok", item, correlationId }, { status: 200 });
  } catch (err) {
    logError("pos scan failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Lookup is temporarily unavailable.");
  }
}
