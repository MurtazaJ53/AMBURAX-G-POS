import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { writeAuditLog } from "@/server/identity/audit";
import { identityNotifier } from "@/server/identity/notifier";
import { generateOtpCode, hashOtpCode, verifyOtpCode } from "@/server/identity/otp";

/**
 * Customer phone verification (Q9, owner 2026-10-14). The server sends a one-time code to the
 * customer's phone; the customer reads it back and staff type it in. Only a correct code sets
 * `phoneVerifiedAt` — nobody can mark a phone verified by hand. Changing the phone clears it
 * (customers.ts), so the new number must be verified again.
 */

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;
/** Resend no sooner than this, so a counter can't flood a customer's phone. */
export const RESEND_AFTER_MS = 60_000;

type Actor = { tenantId: string; userId: string };

export type SendResult =
  | { status: "ok"; expiresAt: Date }
  | { status: "not_found" }
  | { status: "no_phone" }
  | { status: "already_verified" }
  | { status: "too_soon"; retryAfterSeconds: number };

export async function sendPhoneCode(input: { actor: Actor; customerId: string; now?: Date }): Promise<SendResult> {
  const now = input.now ?? new Date();
  const customer = await db.customer.findFirst({
    where: { id: input.customerId, tenantId: input.actor.tenantId, isActive: true },
    select: { id: true, phone: true, phoneVerifiedAt: true },
  });
  if (!customer) return { status: "not_found" };
  if (!customer.phone) return { status: "no_phone" };
  if (customer.phoneVerifiedAt) return { status: "already_verified" };

  const last = await db.customerPhoneChallenge.findFirst({
    where: { tenantId: input.actor.tenantId, customerId: customer.id },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (last && now.getTime() - last.createdAt.getTime() < RESEND_AFTER_MS) {
    return {
      status: "too_soon",
      retryAfterSeconds: Math.ceil((RESEND_AFTER_MS - (now.getTime() - last.createdAt.getTime())) / 1000),
    };
  }

  const code = generateOtpCode();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
  await db.customerPhoneChallenge.create({
    data: {
      tenantId: input.actor.tenantId,
      customerId: customer.id,
      phone: customer.phone,
      codeHash: await hashOtpCode(code),
      expiresAt,
      createdByUserId: input.actor.userId,
      createdAt: now,
    },
  });
  await identityNotifier.sendOtp({ destination: customer.phone, channel: "SMS", code });
  await writeAuditLog({
    tenantId: input.actor.tenantId,
    userId: input.actor.userId,
    action: "CustomerPhoneCodeSent",
    correlationId: randomUUID(),
    metadata: { customerId: customer.id },
  });
  return { status: "ok", expiresAt };
}

export type ConfirmResult =
  | { status: "ok" }
  | { status: "not_found" }
  | { status: "no_code" }
  | { status: "expired" }
  | { status: "phone_changed" }
  | { status: "too_many_attempts" }
  | { status: "wrong_code"; attemptsLeft: number };

export async function confirmPhoneCode(input: { actor: Actor; customerId: string; code: string; now?: Date }): Promise<ConfirmResult> {
  const now = input.now ?? new Date();
  const customer = await db.customer.findFirst({
    where: { id: input.customerId, tenantId: input.actor.tenantId },
    select: { id: true, phone: true },
  });
  if (!customer) return { status: "not_found" };
  const challenge = await db.customerPhoneChallenge.findFirst({
    where: { tenantId: input.actor.tenantId, customerId: customer.id, usedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge) return { status: "no_code" };
  if (challenge.expiresAt <= now) return { status: "expired" };
  if (challenge.attempts >= MAX_ATTEMPTS) return { status: "too_many_attempts" };
  // The code proves this number. If the phone was edited since it was sent, it proves nothing.
  if (challenge.phone !== customer.phone) return { status: "phone_changed" };

  const code = input.code.trim();
  const ok = /^\d{4,8}$/.test(code) && (await verifyOtpCode(code, challenge.codeHash));
  if (!ok) {
    // Counted in the database so two wrong tries at once can't both read the old count.
    const updated = await db.customerPhoneChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    return updated.attempts >= MAX_ATTEMPTS
      ? { status: "too_many_attempts" }
      : { status: "wrong_code", attemptsLeft: MAX_ATTEMPTS - updated.attempts };
  }

  const verified = await db.$transaction(async (tx) => {
    const used = await tx.customerPhoneChallenge.updateMany({
      where: { id: challenge.id, usedAt: null },
      data: { usedAt: now },
    });
    if (used.count !== 1) return false;
    // Only if the phone is still the one the code was sent to.
    const set = await tx.customer.updateMany({
      where: { id: customer.id, tenantId: input.actor.tenantId, phone: challenge.phone },
      data: { phoneVerifiedAt: now },
    });
    return set.count === 1;
  });
  if (!verified) return { status: "phone_changed" };
  await writeAuditLog({
    tenantId: input.actor.tenantId,
    userId: input.actor.userId,
    action: "CustomerPhoneVerified",
    correlationId: randomUUID(),
    metadata: { customerId: customer.id },
  });
  return { status: "ok" };
}
