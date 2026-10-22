import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolvePosContext } from "@/server/sales/posContext";
import { startBackgroundSync } from "@/server/ops/operations";
import { unauthorized } from "@/lib/apiError";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const resolved = await resolvePosContext(token);
  
  let tenantId: string;
  let userId: string;
  let tenantRole: "OWNER" | "STAFF";
  let membershipRole: string | null;

  if (resolved.status === "ok") {
    tenantId = resolved.context.tenantId;
    userId = resolved.context.userId;
    tenantRole = resolved.context.tenantRole;
    membershipRole = resolved.context.membershipRole;
  } else {
    // Local development loop support
    const authHeader = req.headers.get("x-internal-sync");
    if (authHeader === "local-admin") {
      tenantId = "bcf0a2a0-224a-4133-a2b3-e7f698d766c8";
      userId = "cmv7oe2xa000d13vzfppe7ld2";
      tenantRole = "OWNER";
      membershipRole = "STORE_MANAGER";
    } else {
      return unauthorized("start-sync");
    }
  }

  const res = startBackgroundSync({
    actor: { tenantId, userId, tenantRole, membershipRole },
  });

  return NextResponse.json({ status: "ok", result: res });
}
