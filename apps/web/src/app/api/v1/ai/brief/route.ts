import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { apiError, unauthorized, noStore } from "@/lib/apiError";
import { resolvePosContext } from "@/server/sales/posContext";
import { generateAiStoreBrief } from "@/server/ai/commandCenter";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const correlationId = randomUUID();
  try {
    const resolved = await resolvePosContext(req.cookies.get(env.SESSION_COOKIE_NAME)?.value);
    if (resolved.status === "unauthorized") return unauthorized(correlationId);
    if (resolved.status === "no_store") return noStore(correlationId);

    const c = resolved.context;
    const res = await generateAiStoreBrief({
      tenantId: c.tenantId,
      storeId: c.storeId,
    });

    return NextResponse.json({ ...res, correlationId });
  } catch (err) {
    return apiError({
      code: "internal_error",
      status: 500,
      message: "Failed to generate AI command briefing.",
      correlationId,
    });
  }
}
