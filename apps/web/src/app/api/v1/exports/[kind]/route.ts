import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, forbidden, noStore, serviceUnavailable, unauthorized } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { EXPORT_KINDS, exportCsv, type ExportKind } from "@/server/ops/operations";

export const runtime = "nodejs";

/** CSV export (screen 78). Owner only; tenant from the session; audited. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const correlationId = randomUUID();
  const { kind } = await params;
  if (!(EXPORT_KINDS as readonly string[]).includes(kind)) {
    return apiError({ code: "not_found", message: "Unknown export.", status: 404, correlationId });
  }
  try {
    const resolved = await resolvePosContext(req.cookies.get(env.SESSION_COOKIE_NAME)?.value);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);
    const c = resolved.context;
    const res = await exportCsv({ actor: { tenantId: c.tenantId, userId: c.userId, tenantRole: c.tenantRole }, kind: kind as ExportKind });
    if (res.status === "forbidden") return forbidden(correlationId, "Only the owner can export data.");
    const day = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    // A byte-order mark so Excel reads the rupee sign and Indian names correctly.
    return new NextResponse("\uFEFF" + res.csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="amburax-${kind}-${day}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    logError("export: failed", err, { correlationId });
    return serviceUnavailable(correlationId, "Export is temporarily unavailable.");
  }
}
