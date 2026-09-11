import { db } from "@/server/db";
import { env } from "@/lib/env";

const LOCKOUT_MS = env.LOGIN_LOCKOUT_MINUTES * 60 * 1000;

export type AttemptContext =
  | "password"
  | "mfa_verify"
  | "mfa_resend"
  | "password_reset_request"
  | "password_reset_consume"
  | "tenant_registration"
  | "owner_setup"
  | "store_setup"
  | "invitation_create"
  | "invitation_resend"
  | "invitation_accept"
  | "team_step"
  | "onboarding_complete"
  | "pos_setup"
  | "pos_step"
  // The only context whose "email" column is not an email — a device has no user identity
  // (see posDeviceActivation.ts). Stored as the literal "pos-device" so the per-IP window
  // still works and nothing downstream mistakes it for a person.
  | "pos_activate";

/**
 * Durable per-IP rate limit derived from the login_attempts audit trail (survives restarts, no extra store).
 * Scoped by `context` so OTP guessing/resend spam can't borrow headroom from the plain-password limiter.
 */
export async function isIpRateLimited(
  ip: string,
  context: AttemptContext = "password",
  opts?: { windowMs?: number; threshold?: number },
): Promise<boolean> {
  const windowMs = opts?.windowMs ?? LOCKOUT_MS;
  const threshold = opts?.threshold ?? env.LOGIN_MAX_ATTEMPTS * 4; // wider net for distributed attempts across many targets
  const windowStart = new Date(Date.now() - windowMs);
  const recentFailures = await db.loginAttempt.count({
    where: { ip, context, success: false, createdAt: { gte: windowStart } },
  });
  return recentFailures >= threshold;
}

export function isAccountLocked(lockedUntil: Date | null): boolean {
  return !!lockedUntil && lockedUntil.getTime() > Date.now();
}

export async function recordAttempt(params: {
  email: string;
  ip: string;
  success: boolean;
  reason?: string;
  context?: AttemptContext;
}): Promise<void> {
  await db.loginAttempt.create({
    data: {
      email: params.email,
      ip: params.ip,
      context: params.context ?? "password",
      success: params.success,
      reason: params.reason,
    },
  });
}

/** Applies failed-attempt counting and lockout to a user row. Returns the updated lock state. */
export async function registerFailedAttempt(userId: string): Promise<{ lockedUntil: Date | null }> {
  const user = await db.user.update({
    where: { id: userId },
    data: { failedLoginCount: { increment: 1 } },
  });

  if (user.failedLoginCount >= env.LOGIN_MAX_ATTEMPTS) {
    const lockedUntil = new Date(Date.now() + LOCKOUT_MS);
    await db.user.update({
      where: { id: userId },
      data: { lockedUntil, failedLoginCount: 0 },
    });
    return { lockedUntil };
  }

  return { lockedUntil: user.lockedUntil };
}

export async function clearFailedAttempts(userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
}
