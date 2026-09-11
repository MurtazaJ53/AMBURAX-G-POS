import { db } from "@/server/db";
import { env } from "@/lib/env";
import { generateOpaqueToken, hashOpaqueToken } from "@/server/identity/token";
import { isIpRateLimited, recordAttempt } from "@/server/identity/loginGuard";
import { writeAuditLog } from "@/server/identity/audit";
import { hashPairingCode, normalizePairingCode } from "@/server/pos/posDevice";

/**
 * The other half of A9, and the reason A9 can claim anything at all about a *physical*
 * terminal: the device claims its pairing code and becomes ACTIVE.
 *
 * Without this, "POS setup complete" would mean nothing more than "a row exists", which
 * is precisely the fake completion this architecture forbids. `PosDevice.createdAt` and
 * `PosDevice.activatedAt` are separate facts and the UI reports them separately.
 *
 * The caller here is a machine, not a person: this endpoint takes no session and no user
 * identity. The pairing code is the entire credential, exactly as an invitation token is
 * at A11 — possession authorizes one narrow action (claim this one terminal) and confers
 * no user authentication, no tenant authority, and no store access whatsoever.
 *
 * Two credentials, deliberately not one:
 *   in  — the one-time pairing code (short TTL, consumed here, shown once to a human)
 *   out — a 256-bit device secret (long-lived, returned once, never shown to a human)
 * A single long-lived code that doubles as the pairing code would mean the string a
 * merchant reads off a setup screen is also the terminal's permanent credential.
 */

export type ActivatePosDeviceResult =
  | { status: "rate_limited" }
  | { status: "invalid" }
  | { status: "expired" }
  | { status: "already_activated" }
  | { status: "disabled" }
  | {
      status: "ok";
      device: { id: string; name: string; code: string; storeId: string; tenantId: string };
      // Returned exactly once. The device must persist it in platform secure storage
      // (OFFLINE_POS.md §28); it is unrecoverable afterwards and re-pairing is the only
      // remedy for a lost one.
      deviceSecret: string;
    };

export async function activatePosDevice(params: {
  pairingCode: string;
  ip: string;
  correlationId: string;
}): Promise<ActivatePosDeviceResult> {
  if (
    await isIpRateLimited(params.ip, "pos_activate", {
      windowMs: 60 * 60 * 1000,
      threshold: env.POS_ACTIVATE_MAX_PER_WINDOW,
    })
  ) {
    return { status: "rate_limited" };
  }

  const normalized = normalizePairingCode(params.pairingCode);
  const device = await db.posDevice.findUnique({
    where: { pairingCodeHash: hashPairingCode(normalized) },
    select: {
      id: true,
      name: true,
      code: true,
      storeId: true,
      tenantId: true,
      activatedAt: true,
      disabledAt: true,
      pairingExpiresAt: true,
    },
  });

  if (!device) {
    // Covers a wrong code and an already-consumed one identically: consumption nulls
    // `pairingCodeHash`, so a replayed code is simply unknown. Recorded as a failed
    // attempt so the rate limiter actually sees guessing.
    await recordAttempt({
      email: "pos-device",
      ip: params.ip,
      success: false,
      reason: "invalid_pairing_code",
      context: "pos_activate",
    });
    return { status: "invalid" };
  }

  if (device.disabledAt) return { status: "disabled" };
  if (device.activatedAt) return { status: "already_activated" };
  if (device.pairingExpiresAt && device.pairingExpiresAt.getTime() <= Date.now()) {
    return { status: "expired" };
  }

  const deviceSecret = generateOpaqueToken();

  // The claim, not the read above, is what arbitrates concurrency: two terminals racing
  // with the same code both reach here, but only one `updateMany` matches — the winner
  // nulls `pairingCodeHash` in the same statement, so the loser matches zero rows and is
  // issued no secret. Single statement, so there is nothing to roll back.
  const claimed = await db.posDevice.updateMany({
    where: {
      id: device.id,
      activatedAt: null,
      disabledAt: null,
      pairingCodeHash: hashPairingCode(normalized),
      pairingExpiresAt: { gt: new Date() },
    },
    data: {
      activatedAt: new Date(),
      lastSeenAt: new Date(),
      deviceSecretHash: hashOpaqueToken(deviceSecret),
      pairingCodeHash: null,
      pairingExpiresAt: null,
    },
  });

  if (claimed.count === 0) {
    return { status: "already_activated" };
  }

  await writeAuditLog({
    tenantId: device.tenantId,
    action: "PosDeviceActivated",
    correlationId: params.correlationId,
    metadata: { posDeviceId: device.id, storeId: device.storeId },
  });

  return {
    status: "ok",
    device: {
      id: device.id,
      name: device.name,
      code: device.code,
      storeId: device.storeId,
      tenantId: device.tenantId,
    },
    deviceSecret,
  };
}
