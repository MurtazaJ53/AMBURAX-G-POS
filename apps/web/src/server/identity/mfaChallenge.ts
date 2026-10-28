import { db } from "@/server/db";
import { env } from "@/lib/env";
import { generateOtpCode, hashOtpCode, verifyOtpCode } from "@/server/identity/otp";
import { identityNotifier } from "@/server/identity/notifier";
import { isIpRateLimited, recordAttempt } from "@/server/identity/loginGuard";
import { createSession } from "@/server/identity/session";
import { writeAuditLog } from "@/server/identity/audit";
import { generateOpaqueToken, hashOpaqueToken } from "@/server/identity/token";

type MfaChannel = "SMS" | "WHATSAPP" | "EMAIL";

export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  if (!domain || local.length <= 2) return `${local[0] ?? "*"}***@${domain}`;
  return `${local.slice(0, 2)}${"*".repeat(Math.max(local.length - 2, 3))}@${domain}`;
}

/** Issued right after a password-correct, MFA-required login. Never exposes the raw userId to the client. */
export async function createMfaChallenge(params: {
  userId: string;
  tenantId: string;
  email: string;
  ip: string | null;
  userAgent: string | null;
  channel?: MfaChannel;
}): Promise<{ challengeToken: string; expiresAt: string; maskedDestination: string }> {
  const code = generateOtpCode();
  const codeHash = await hashOtpCode(code);
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + env.OTP_TTL_MINUTES * 60 * 1000);
  const channel = params.channel ?? "SMS";

  await db.mfaChallenge.create({
    data: {
      userId: params.userId,
      tenantId: params.tenantId,
      tokenHash: hashOpaqueToken(token),
      codeHash,
      channel,
      ip: params.ip ?? undefined,
      userAgent: params.userAgent ?? undefined,
      expiresAt,
    },
  });

  await identityNotifier.sendOtp({ destination: params.email, channel, code });
  await writeAuditLog({
    tenantId: params.tenantId,
    userId: params.userId,
    action: "MfaChallengeIssued",
    correlationId: token.slice(0, 16),
  });

  return {
    challengeToken: token,
    expiresAt: expiresAt.toISOString(),
    maskedDestination: maskEmail(params.email),
  };
}

export type ResendResult =
  | { status: "invalid" }
  | { status: "expired" }
  | { status: "cooldown"; retryAfterSeconds: number }
  | { status: "max_resends" }
  | { status: "ok"; expiresAt: string; maskedDestination: string };

export async function resendMfaChallenge(params: {
  challengeToken: string;
  ip: string;
  channel?: MfaChannel;
}): Promise<ResendResult> {
  const challenge = await db.mfaChallenge.findUnique({
    where: { tokenHash: hashOpaqueToken(params.challengeToken) },
    include: { user: true },
  });

  if (!challenge || challenge.consumedAt) {
    return { status: "invalid" };
  }

  const ageMs = Date.now() - challenge.createdAt.getTime();
  if (ageMs > env.MFA_CHALLENGE_MAX_AGE_MINUTES * 60 * 1000) {
    return { status: "expired" };
  }

  const secondsSinceLastSend = (Date.now() - challenge.lastSentAt.getTime()) / 1000;
  if (secondsSinceLastSend < env.OTP_RESEND_COOLDOWN_SECONDS) {
    return {
      status: "cooldown",
      retryAfterSeconds: Math.ceil(env.OTP_RESEND_COOLDOWN_SECONDS - secondsSinceLastSend),
    };
  }

  if (challenge.resendCount >= env.OTP_MAX_RESENDS) {
    return { status: "max_resends" };
  }

  const code = generateOtpCode();
  const codeHash = await hashOtpCode(code);
  const expiresAt = new Date(Date.now() + env.OTP_TTL_MINUTES * 60 * 1000);
  const channel = params.channel ?? challenge.channel;

  await db.mfaChallenge.update({
    where: { id: challenge.id },
    data: {
      codeHash,
      channel,
      expiresAt,
      lastSentAt: new Date(),
      resendCount: { increment: 1 },
      attempts: 0, // a fresh code resets the guess counter for that code
    },
  });

  await identityNotifier.sendOtp({ destination: challenge.user.email, channel, code });
  await writeAuditLog({
    tenantId: challenge.tenantId,
    userId: challenge.userId,
    action: "MfaChallengeResent",
    correlationId: params.challengeToken.slice(0, 16),
  });

  return {
    status: "ok",
    expiresAt: expiresAt.toISOString(),
    maskedDestination: maskEmail(challenge.user.email),
  };
}

export type VerifyMfaResult =
  | { status: "rate_limited" }
  | { status: "invalid" }
  | { status: "expired" }
  | { status: "too_many_attempts" }
  | { status: "incorrect_code"; attemptsRemaining: number }
  | {
      status: "ok";
      sessionToken: string;
      expiresAt: string;
      user: { id: string; name: string; email: string };
      tenant: { id: string; name: string };
      storeCount: number;
    };

export async function verifyMfaChallenge(params: {
  challengeToken: string;
  code: string;
  ip: string;
  userAgent: string | null;
}): Promise<VerifyMfaResult> {
  if (await isIpRateLimited(params.ip, "mfa_verify", { windowMs: 15 * 60 * 1000, threshold: env.OTP_MAX_ATTEMPTS * 6 })) {
    return { status: "rate_limited" };
  }

  const challenge = await db.mfaChallenge.findUnique({
    where: { tokenHash: hashOpaqueToken(params.challengeToken) },
    include: { user: { include: { tenant: true, memberships: true } } },
  });

  // Same generic response whether the token is unknown or already consumed (replay prevention
  // must not be distinguishable from "never existed" — otherwise it's a reuse oracle).
  if (!challenge || challenge.consumedAt) {
    return { status: "invalid" };
  }

  if (challenge.expiresAt.getTime() < Date.now()) {
    return { status: "expired" };
  }

  if (challenge.attempts >= env.OTP_MAX_ATTEMPTS) {
    return { status: "too_many_attempts" };
  }

  const codeOk = await verifyOtpCode(params.code, challenge.codeHash);

  if (!codeOk) {
    const updated = await db.mfaChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    await recordAttempt({
      email: challenge.user.email,
      ip: params.ip,
      success: false,
      reason: "bad_otp",
      context: "mfa_verify",
    });
    await writeAuditLog({
      tenantId: challenge.tenantId,
      userId: challenge.userId,
      action: "MfaChallengeFailed",
      correlationId: params.challengeToken.slice(0, 16),
    });

    if (updated.attempts >= env.OTP_MAX_ATTEMPTS) {
      // Burn the challenge: no more guesses even if the client retries this same token.
      await db.mfaChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
      return { status: "too_many_attempts" };
    }

    return { status: "incorrect_code", attemptsRemaining: env.OTP_MAX_ATTEMPTS - updated.attempts };
  }

  await db.mfaChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
  await recordAttempt({ email: challenge.user.email, ip: params.ip, success: true, context: "mfa_verify" });

  const session = await createSession({
    userId: challenge.userId,
    tenantId: challenge.tenantId,
    ip: params.ip,
    userAgent: params.userAgent,
  });

  await writeAuditLog({
    tenantId: challenge.tenantId,
    userId: challenge.userId,
    action: "MFACompleted",
    correlationId: params.challengeToken.slice(0, 16),
  });
  await writeAuditLog({
    tenantId: challenge.tenantId,
    userId: challenge.userId,
    action: "LoginSucceeded",
    correlationId: params.challengeToken.slice(0, 16),
  });

  return {
    status: "ok",
    sessionToken: session.token,
    expiresAt: session.expiresAt.toISOString(),
    user: { id: challenge.user.id, name: challenge.user.name, email: challenge.user.email },
    tenant: { id: challenge.user.tenant.id, name: challenge.user.tenant.name },
    storeCount: challenge.user.memberships.length,
  };
}
