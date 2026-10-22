import { db } from "@/server/db";
import { env } from "@/lib/env";
import { generateOpaqueToken, hashOpaqueToken } from "@/server/identity/token";
import { hashPassword, verifyPassword, TIMING_SAFETY_DUMMY_HASH } from "@/server/identity/password";
import { validatePasswordStrength } from "@/server/identity/passwordPolicy";
import { identityNotifier } from "@/server/identity/notifier";
import { isIpRateLimited, recordAttempt } from "@/server/identity/loginGuard";
import { writeAuditLog } from "@/server/identity/audit";

/**
 * Pure predicate, unit-testable without a database: has enough time passed since the
 * last reset email to allow another one? Mirrors loginGuard.ts's isAccountLocked shape.
 */
export function isWithinCooldown(lastSentAt: Date, cooldownSeconds: number): boolean {
  return Date.now() - lastSentAt.getTime() < cooldownSeconds * 1000;
}

export type RequestResetResult =
  | { status: "rate_limited" }
  | { status: "accepted"; devResetLink?: string };

/**
 * Always returns "accepted" for every outcome except IP rate limiting — unknown email,
 * disabled account, and cooldown-throttled repeats are all silent no-ops from the
 * caller's point of view. The route handler must render every "accepted" result with
 * the exact same generic message; branching the UI on the internal reason would leak
 * account existence just as surely as branching the API response would.
 */
export async function requestPasswordReset(params: {
  email: string;
  ip: string;
  userAgent: string | null;
  correlationId: string;
}): Promise<RequestResetResult> {
  const email = params.email.trim().toLowerCase();

  if (
    await isIpRateLimited(params.ip, "password_reset_request", {
      windowMs: 60 * 60 * 1000, // 1 hour window
      threshold: 3, // max 3 requests per hour per IP
    })
  ) {
    await writeAuditLog({
      action: "PasswordResetRateLimited",
      correlationId: params.correlationId,
      metadata: { ip: params.ip },
    });
    return { status: "rate_limited" };
  }

  const user = await db.user.findUnique({ where: { email } });

  if (!user) {
    // Same bcrypt cost as a real request's hashing work, so "no such account" isn't
    // distinguishable from "account found, cooldown/disabled" by response timing.
    await verifyPassword(params.email, TIMING_SAFETY_DUMMY_HASH);
    await recordAttempt({ email, ip: params.ip, success: false, reason: "no_such_user", context: "password_reset_request" });
    return { status: "accepted" };
  }

  if (user.status === "DISABLED") {
    await verifyPassword(params.email, TIMING_SAFETY_DUMMY_HASH);
    await recordAttempt({ email, ip: params.ip, success: false, reason: "disabled", context: "password_reset_request" });
    await writeAuditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action: "PasswordResetBlockedDisabledAccount",
      correlationId: params.correlationId,
    });
    return { status: "accepted" };
  }

  const lastToken = await db.passwordResetToken.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });

  if (lastToken && isWithinCooldown(lastToken.createdAt, env.RESET_REQUEST_COOLDOWN_SECONDS)) {
    await verifyPassword(params.email, TIMING_SAFETY_DUMMY_HASH);
    await recordAttempt({ email, ip: params.ip, success: false, reason: "cooldown", context: "password_reset_request" });
    return { status: "accepted" };
  }

  // Supersede: a fresh request invalidates every previously-issued, still-usable link for
  // this user (ADR-027) — an intercepted older email can't be used once a newer one exists.
  await db.passwordResetToken.updateMany({
    where: { userId: user.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });

  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.RESET_TOKEN_TTL_MINUTES * 60 * 1000);

  await db.passwordResetToken.create({
    data: {
      userId: user.id,
      tenantId: user.tenantId,
      tokenHash: hashOpaqueToken(token),
      ip: params.ip,
      userAgent: params.userAgent ?? undefined,
      expiresAt,
    },
  });

  const resetUrl = `${env.APP_BASE_URL}/auth/reset-password?token=${token}`;
  await identityNotifier.sendPasswordResetLink({ destination: user.email, resetUrl });
  await recordAttempt({ email, ip: params.ip, success: true, context: "password_reset_request" });
  await writeAuditLog({
    tenantId: user.tenantId,
    userId: user.id,
    action: "PasswordResetRequested",
    correlationId: params.correlationId,
  });

  return {
    status: "accepted",
    ...(env.DEV_RESET_LINK_ECHO ? { devResetLink: resetUrl } : {}),
  };
}

export type ConsumeResetResult =
  | { status: "rate_limited" }
  | { status: "invalid" }
  | { status: "expired" }
  | { status: "weak_password"; reason: string }
  | { status: "same_as_current" }
  | { status: "ok"; userId: string; tenantId: string };

/** Thrown inside the transaction when a concurrent request already claimed the token; caught below. */
class TokenAlreadyClaimedError extends Error {}

/**
 * A4 (Reset Password) — POST /api/v1/auth/password/reset.
 *
 * Token possession is the only credential here (a 256-bit random value, not a guessable
 * identifier), so — unlike A2's OTP or A3's email lookup — "expired" and "invalid" are
 * deliberately kept distinguishable: only someone who already holds the exact token can
 * ever reach this branch, so the distinction leaks nothing to anyone who doesn't already
 * have it, and it's meaningfully better UX ("your link expired, request a new one" vs.
 * "this link is wrong"). See SECURITY.md's enumeration-safe-pattern note for the contrast.
 */
export async function consumePasswordReset(params: {
  token: string;
  newPassword: string;
  ip: string;
  correlationId: string;
}): Promise<ConsumeResetResult> {
  if (
    await isIpRateLimited(params.ip, "password_reset_consume", {
      windowMs: 15 * 60 * 1000,
      threshold: env.RESET_CONSUME_MAX_PER_WINDOW,
    })
  ) {
    return { status: "rate_limited" };
  }

  const record = await db.passwordResetToken.findUnique({
    where: { tokenHash: hashOpaqueToken(params.token) },
    include: { user: true },
  });

  // Same response for "never existed" and "already used" — replay must not be a
  // distinguishable oracle from an unknown token.
  if (!record || record.consumedAt) {
    await recordAttempt({
      email: record?.user.email ?? "unknown",
      ip: params.ip,
      success: false,
      reason: "invalid_or_replayed",
      context: "password_reset_consume",
    });
    return { status: "invalid" };
  }

  if (record.expiresAt.getTime() < Date.now()) {
    await recordAttempt({ email: record.user.email, ip: params.ip, success: false, reason: "expired", context: "password_reset_consume" });
    return { status: "expired" };
  }

  const strength = validatePasswordStrength(params.newPassword);
  if (!strength.ok) {
    await recordAttempt({ email: record.user.email, ip: params.ip, success: false, reason: "weak_password", context: "password_reset_consume" });
    return { status: "weak_password", reason: strength.reason };
  }

  if (await verifyPassword(params.newPassword, record.user.passwordHash)) {
    await recordAttempt({ email: record.user.email, ip: params.ip, success: false, reason: "same_as_current", context: "password_reset_consume" });
    return { status: "same_as_current" };
  }

  const passwordHash = await hashPassword(params.newPassword);

  try {
    await db.$transaction(async (tx) => {
      // Conditional on consumedAt still being null: this is the fix for a real race —
      // two concurrent requests with the same token could otherwise both pass the check
      // above and both write, making "single-use" non-atomic. Only one `updateMany` here
      // can ever match and claim the row; the loser sees count 0 and aborts the transaction.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new TokenAlreadyClaimedError();
      }

      await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });

      // Superseding siblings too closes the "requested twice, used the older one" replay gap.
      await tx.passwordResetToken.updateMany({
        where: { userId: record.userId, consumedAt: null },
        data: { consumedAt: new Date() },
      });

      // A changed password must invalidate every existing session — an attacker who stole
      // a session before the owner regained control should not stay logged in.
      await tx.session.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
  } catch (err) {
    if (err instanceof TokenAlreadyClaimedError) {
      await recordAttempt({ email: record.user.email, ip: params.ip, success: false, reason: "lost_claim_race", context: "password_reset_consume" });
      return { status: "invalid" };
    }
    throw err;
  }

  await recordAttempt({ email: record.user.email, ip: params.ip, success: true, context: "password_reset_consume" });
  await writeAuditLog({
    tenantId: record.tenantId,
    userId: record.userId,
    action: "PasswordChanged",
    correlationId: params.correlationId,
  });
  await writeAuditLog({
    tenantId: record.tenantId,
    userId: record.userId,
    action: "AllSessionsRevokedAfterPasswordReset",
    correlationId: params.correlationId,
  });

  return { status: "ok", userId: record.userId, tenantId: record.tenantId };
}
