import { db } from "@/server/db";
import { env } from "@/lib/env";
import { generateOpaqueToken, hashOpaqueToken } from "@/server/identity/token";

/**
 * Reuses the same opaque-token shape as sessions/MFA/reset tokens (src/server/identity/token.ts)
 * but is deliberately its own model, not a Session — see the comment on OnboardingSession in
 * schema.prisma for why. Grants no application access; it authorizes only "continue setting up
 * this one tenant," which A6-A10 will consume.
 */
export async function createOnboardingSession(params: {
  tenantId: string;
  ip: string | null;
  userAgent: string | null;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.ONBOARDING_SESSION_TTL_MINUTES * 60 * 1000);

  await db.onboardingSession.create({
    data: {
      tenantId: params.tenantId,
      tokenHash: hashOpaqueToken(token),
      ip: params.ip ?? undefined,
      userAgent: params.userAgent ?? undefined,
      expiresAt,
    },
  });

  return { token, expiresAt };
}

/**
 * Not yet called by a route — A6 (Owner Account) is the first screen that needs to resolve
 * an onboarding token back to a tenant. Included now so the shape is settled before A6 needs
 * it, the same way A1 anticipated A2's contract without implementing A2's route.
 */
export async function resolveOnboardingSession(token: string) {
  const session = await db.onboardingSession.findUnique({
    where: { tokenHash: hashOpaqueToken(token) },
    include: { tenant: true },
  });

  if (!session || session.expiresAt.getTime() < Date.now() || session.tenant.onboardingStep === "COMPLETE") {
    return null;
  }

  return session;
}
