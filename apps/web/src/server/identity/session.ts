import { db } from "@/server/db";
import { env } from "@/lib/env";
import { generateOpaqueToken, hashOpaqueToken } from "@/server/identity/token";

/**
 * Opaque, DB-backed session so A14 (Sessions/Devices) can list and revoke
 * individual sessions server-side — a signed stateless JWT could not do that.
 */
export async function createSession(params: {
  userId: string;
  tenantId: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 60 * 60 * 1000);

  await db.session.create({
    data: {
      userId: params.userId,
      tenantId: params.tenantId,
      tokenHash: hashOpaqueToken(token),
      ip: params.ip ?? undefined,
      userAgent: params.userAgent ?? undefined,
      expiresAt,
    },
  });

  return { token, expiresAt };
}

export async function resolveSession(token: string) {
  const session = await db.session.findUnique({
    where: { tokenHash: hashOpaqueToken(token) },
    include: { user: true },
  });

  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
    return null;
  }

  return session;
}
