import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore, forbidden } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { IMPORT_KINDS, type ImportKind } from "@/server/imports/importFields";
import { MAX_IMPORT_ROWS, runImport } from "@/server/imports/importService";

export const runtime = "nodejs";
export const maxDuration = 300;

const body = z
  .object({
    batchId: z.string().min(8).max(64),
    firstRowNumber: z.number().int().min(1),
    rows: z.array(z.record(z.string(), z.string().max(2000).optional())).min(1).max(MAX_IMPORT_ROWS),
  })
  .strict();

/** Import one batch of already-mapped rows (owner). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ kind: string }> }) {
  const correlationId = randomUUID();
  const { kind } = await ctx.params;
  if (!(IMPORT_KINDS as readonly string[]).includes(kind)) return apiError({ code: "not_found", status: 404, message: "Unknown import.", correlationId });
  try {
    const resolved = await resolvePosContext(req.cookies.get(env.SESSION_COOKIE_NAME)?.value);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return apiError({ code: "validation_error", status: 400, message: "That batch couldn't be read.", correlationId });
    const c = resolved.context;
    const res = await runImport({
      actor: { tenantId: c.tenantId, userId: c.userId, tenantRole: c.tenantRole },
      storeId: c.storeId,
      kind: kind as ImportKind,
      ...parsed.data,
    });
    if (res.status === "forbidden") return forbidden(correlationId, "Only the owner can import data.");
    if (res.status === "invalid") return apiError({ code: "validation_error", status: 400, message: res.reason, correlationId });
    return NextResponse.json({ status: "ok", ...res.outcome, correlationId });
  } catch (err) {
    logError("imports: batch failed", err, { correlationId });
    return apiError({ code: "internal_error", status: 500, message: "That batch failed. Rows before it are saved; try again.", correlationId });
  }
}
