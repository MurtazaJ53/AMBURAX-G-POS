import { db } from "@/server/db";
import { verifyPassword, TIMING_SAFETY_DUMMY_HASH } from "@/server/identity/password";
import {
  isIpRateLimited,
  isAccountLocked,
  recordAttempt,
  registerFailedAttempt,
  clearFailedAttempts,
} from "@/server/identity/loginGuard";
import { createSession } from "@/server/identity/session";
import { writeAuditLog } from "@/server/identity/audit";
import { createMfaChallenge } from "@/server/identity/mfaChallenge";

export type LoginResult =
  | { status: "rate_limited" }
  | { status: "invalid_credentials" }
  | { status: "account_locked"; lockedUntil: string }
  | { status: "account_disabled" }
  | { status: "mfa_required"; challengeToken: string; expiresAt: string; maskedDestination: string; devCode?: string }
  | {
      status: "ok";
      sessionToken: string;
      expiresAt: string;
      user: { id: string; name: string; email: string };
      tenant: { id: string; name: string };
      storeCount: number;
    };

// Generic message shown to the client — never reveals whether the email exists.
export const GENERIC_INVALID_CREDENTIALS = "The email or password you entered is incorrect.";

export async function login(params: {
  email: string;
  password: string;
  ip: string;
  userAgent: string | null;
  correlationId: string;
}): Promise<LoginResult> {
  const email = params.email.trim().toLowerCase();

  if (await isIpRateLimited(params.ip)) {
    await writeAuditLog({
      action: "LoginRateLimited",
      correlationId: params.correlationId,
      metadata: { ip: params.ip },
    });
    return { status: "rate_limited" };
  }

  const user = await db.user.findUnique({
    where: { email },
    include: { tenant: true, memberships: true },
  });

  if (!user) {
    // Burn the same bcrypt.compare cost a real password check would take. Without this,
    // "no such user" returns measurably faster than "wrong password for a real user" —
    // a timing side-channel that defeats the generic error message below.
    await verifyPassword(params.password, TIMING_SAFETY_DUMMY_HASH);
    // Still record the attempt (by email, no user id) so brute-force sweeps are visible and rate-limited.
    await recordAttempt({ email, ip: params.ip, success: false, reason: "no_such_user" });
    return { status: "invalid_credentials" };
  }

  if (isAccountLocked(user.lockedUntil)) {
    await recordAttempt({ email, ip: params.ip, success: false, reason: "locked" });
    return { status: "account_locked", lockedUntil: user.lockedUntil!.toISOString() };
  }

  if (user.status === "DISABLED") {
    await recordAttempt({ email, ip: params.ip, success: false, reason: "disabled" });
    await writeAuditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action: "LoginBlockedDisabledAccount",
      correlationId: params.correlationId,
    });
    return { status: "account_disabled" };
  }

  const passwordOk = await verifyPassword(params.password, user.passwordHash);

  if (!passwordOk) {
    await recordAttempt({ email, ip: params.ip, success: false, reason: "bad_password" });
    const { lockedUntil } = await registerFailedAttempt(user.id);
    await writeAuditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action: "LoginFailed",
      correlationId: params.correlationId,
    });
    if (lockedUntil) {
      return { status: "account_locked", lockedUntil: lockedUntil.toISOString() };
    }
    return { status: "invalid_credentials" };
  }

  await recordAttempt({ email, ip: params.ip, success: true });
  await clearFailedAttempts(user.id);

  if (user.mfaEnabled) {
    // A2 (Verification/OTP/MFA) owns completing this challenge; A1 stops short of issuing a session.
    await writeAuditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action: "LoginRequiresMfa",
      correlationId: params.correlationId,
    });
    const challenge = await createMfaChallenge({
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      ip: params.ip,
      userAgent: params.userAgent,
    });
    return {
      status: "mfa_required",
      challengeToken: challenge.challengeToken,
      expiresAt: challenge.expiresAt,
      maskedDestination: challenge.maskedDestination,
      ...(challenge.devCode ? { devCode: challenge.devCode } : {}),
    };
  }

  const session = await createSession({
    userId: user.id,
    tenantId: user.tenantId,
    ip: params.ip,
    userAgent: params.userAgent,
  });

  await writeAuditLog({
    tenantId: user.tenantId,
    userId: user.id,
    action: "LoginSucceeded",
    correlationId: params.correlationId,
  });

  return {
    status: "ok",
    sessionToken: session.token,
    expiresAt: session.expiresAt.toISOString(),
    user: { id: user.id, name: user.name, email: user.email },
    tenant: { id: user.tenant.id, name: user.tenant.name },
    storeCount: user.memberships.length,
  };
}
