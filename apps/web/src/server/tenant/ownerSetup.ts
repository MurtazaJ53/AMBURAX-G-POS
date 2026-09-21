import { db } from "@/server/db";
import { env } from "@/lib/env";
import { resolveOnboardingSession } from "@/server/tenant/onboardingSession";
import { hashPassword } from "@/server/identity/password";
import { validatePasswordStrength } from "@/server/identity/passwordPolicy";
import { createSession } from "@/server/identity/session";
import { isIpRateLimited, recordAttempt } from "@/server/identity/loginGuard";
import { writeAuditLog } from "@/server/identity/audit";
import { Prisma } from "@prisma/client";

export interface CreateOwnerInput {
  onboardingToken: string;
  name: string;
  email: string;
  password: string;
  ip: string;
  userAgent: string | null;
  correlationId: string;
}

export type CreateOwnerResult =
  | { status: "rate_limited" }
  | { status: "invalid_session" }
  | { status: "already_completed" }
  | { status: "weak_password"; reason: string }
  | { status: "email_taken" }
  | {
      status: "ok";
      sessionToken: string;
      expiresAt: string;
      user: { id: string; name: string; email: string };
      tenant: { id: string; name: string };
    };

/** Thrown inside the transaction when a concurrent request already claimed this tenant's owner step. */
class StepAlreadyClaimedError extends Error {}

function isUniqueViolation(err: unknown, field: string): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    Array.isArray(err.meta?.target) &&
    (err.meta!.target as string[]).includes(field)
  );
}

/**
 * A6 — the first real User for a tenant, created from an OnboardingSession issued by A5.
 *
 * Unlike A4's PasswordResetToken, the OnboardingSession itself is NOT consumed here — it
 * stays valid (until expiry or the tenant reaching COMPLETE) because A7-A10 reuse the same
 * token. The one-time gate for *this* step is `Tenant.onboardingStep` itself: the
 * transaction's first statement conditionally claims BUSINESS_CREATED -> OWNER_CREATED,
 * exactly mirroring A4's atomic-claim fix (ADR-031) but on a different column. Two
 * concurrent requests against the same onboarding session can only have one winner; the
 * loser's `updateMany` matches zero rows and the whole transaction aborts before any User
 * is created — see SECURITY.md's "single-use token claims must be atomic" section, which
 * this generalizes from "consume a token" to "advance a one-time state transition."
 *
 * A retry that arrives *after* the tenant already has an owner (network loss, resubmit) is
 * deliberately NOT turned into a fresh login session — see DECISIONS.md ADR-042 for why
 * that's a security tradeoff, not an oversight.
 */
export async function createOwnerAccount(input: CreateOwnerInput): Promise<CreateOwnerResult> {
  if (
    await isIpRateLimited(input.ip, "owner_setup", {
      windowMs: 60 * 60 * 1000,
      threshold: env.OWNER_SETUP_MAX_PER_WINDOW,
    })
  ) {
    return { status: "rate_limited" };
  }

  const session = await resolveOnboardingSession(input.onboardingToken);
  if (!session) {
    return { status: "invalid_session" };
  }

  if (session.tenant.onboardingStep !== "BUSINESS_CREATED") {
    // Either a concurrent request already won (see below) or this is a stale repeat of
    // an already-completed step. Same safe response either way — no mutation, no user.
    return { status: "already_completed" };
  }

  const strength = validatePasswordStrength(input.password);
  if (!strength.ok) {
    return { status: "weak_password", reason: strength.reason };
  }

  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);

  try {
    const result = await db.$transaction(async (tx) => {
      const claimed = await tx.tenant.updateMany({
        where: { id: session.tenantId, onboardingStep: "BUSINESS_CREATED" },
        data: { onboardingStep: "OWNER_CREATED" },
      });
      if (claimed.count === 0) {
        throw new StepAlreadyClaimedError();
      }

      const user = await tx.user.create({
        data: {
          tenantId: session.tenantId,
          email,
          passwordHash,
          name: input.name,
          tenantRole: "OWNER",
        },
      });

      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: session.tenantId } });

      // Invalidate the onboarding session now that owner setup is complete.
      await tx.onboardingSession.deleteMany({
        where: { tenantId: session.tenantId }
      });

      return { user, tenant };
    });

    const newSession = await createSession({
      userId: result.user.id,
      tenantId: result.tenant.id,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    await recordAttempt({ email, ip: input.ip, success: true, context: "owner_setup" });
    await writeAuditLog({
      tenantId: result.tenant.id,
      userId: result.user.id,
      action: "OwnerAccountCreated",
      correlationId: input.correlationId,
    });
    await writeAuditLog({
      tenantId: result.tenant.id,
      userId: result.user.id,
      action: "OnboardingStepAdvanced",
      correlationId: input.correlationId,
      metadata: { from: "BUSINESS_CREATED", to: "OWNER_CREATED" },
    });

    return {
      status: "ok",
      sessionToken: newSession.token,
      expiresAt: newSession.expiresAt.toISOString(),
      user: { id: result.user.id, name: result.user.name, email: result.user.email },
      tenant: { id: result.tenant.id, name: result.tenant.name },
    };
  } catch (err) {
    if (err instanceof StepAlreadyClaimedError) {
      await recordAttempt({ email, ip: input.ip, success: false, reason: "lost_step_race", context: "owner_setup" });
      return { status: "already_completed" };
    }
    if (isUniqueViolation(err, "email")) {
      // Transaction rolled back in full, including the tenant-step claim — the tenant is
      // still at BUSINESS_CREATED and can be retried with a different email.
      await recordAttempt({ email, ip: input.ip, success: false, reason: "email_taken", context: "owner_setup" });
      return { status: "email_taken" };
    }
    throw err;
  }
}
