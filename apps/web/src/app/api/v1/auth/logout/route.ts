import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { writeAuditLog } from "@/server/identity/audit";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(env.SESSION_COOKIE_NAME)?.value;
  const res = NextResponse.json({ status: "ok" });
  res.cookies.delete(env.SESSION_COOKIE_NAME);

  if (!token) return res;

  const session = await resolveSession(token);
  if (session) {
    await db.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await writeAuditLog({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "SessionRevoked",
      correlationId: req.headers.get("x-correlation-id") ?? randomUUID(),
    });
  }

  return res;
}
