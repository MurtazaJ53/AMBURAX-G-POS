import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { apiError, unauthorized, noStore, forbidden } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { IMPORT_KINDS } from "@/server/imports/importFields";
import { smartMapColumns } from "@/server/imports/smartMap";

export const runtime = "nodejs";

const body = z
  .object({
    kind: z.enum(IMPORT_KINDS),
    headers: z.array(z.string().max(200)).min(1).max(80),
    sample: z.array(z.array(z.string().max(300)).max(80)).max(5),
  })
  .strict();

/** Smart import: let the owner's AI match the file's columns to ours. */
export async function POST(req: NextRequest) {
  const correlationId = randomUUID();
  try {
    const resolved = await resolvePosContext(req.cookies.get(env.SESSION_COOKIE_NAME)?.value);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);
    if (resolved.context.tenantRole !== "OWNER") return forbidden(correlationId, "Only the owner can import data.");
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return apiError({ code: "validation_error", status: 400, message: "Couldn't read the columns.", correlationId });
    const res = await smartMapColumns({ tenantId: resolved.context.tenantId, ...parsed.data });
    if (res.status === "no_key") return apiError({ code: "ai_not_set_up", status: 409, message: "Smart matching needs an AI key in Settings → AI.", correlationId });
    if (res.status === "ai_error") return apiError({ code: "ai_error", status: 502, message: res.message, correlationId });
    return NextResponse.json({ status: "ok", mapping: res.mapping, correlationId });
  } catch (err) {
    logError("imports/map: failed", err, { correlationId });
    return apiError({ code: "internal_error", status: 500, message: "Smart matching failed. Match the columns by hand.", correlationId });
  }
}
