import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { env } from "@/lib/env";
import { writeAuditLog } from "@/server/identity/audit";
import { enqueueOutboxEvent } from "@/server/events/outbox";
import { Capability } from "@/server/capability/capabilities";
import { requireCapability } from "@/server/capability/capabilityService";
import { canConfigurePos } from "@/server/pos/posRoles";
import { generatePairingCode, hashPairingCode, formatPairingCode } from "@/server/pos/posDevice";

/**
 * Registering a terminal, during onboarding and afterwards.
 *
 * ## The gap this closes
 *
 * Until now the only way to create a terminal was the onboarding step, and that step claims the
 * tenant's `onboardingStep` in the same transaction — `POS_STEP_PREDECESSORS -> POS_CONFIGURED`,
 * refusing with `already_completed` when the claim matches nothing. That claim is *correct*
 * during setup: it makes the step advance exactly once under concurrent submissions. It is
 * simply the wrong gate afterwards, and it meant a business that finished setup without a till,
 * or later bought a second one, had no supported way to add it.
 *
 * ## One creation rule, two callers
 *
 *     createFirstPosDevice()   (onboarding: also claims the step)
 *              \
 *               `--> provisionPosDevice()  <-- the row, the pairing code, the event
 *              /
 *     createPosDevice()        (post-onboarding: no step, no rate limiter)
 *
 * The shared primitive exists so the rules that matter — what a terminal row contains, that a
 * pairing code is issued and only ever stored hashed, that a `PosDeviceCreated` event is
 * enqueued in the same transaction — are written once. Copying them would let the two paths
 * drift, and the one that drifted would be the one nobody was looking at.
 *
 * ## What the new path deliberately does not inherit
 *
 * - **The onboarding step claim.** Nothing advances; a completed tenant stays completed.
 * - **The `pos_setup` IP rate limiter.** That limiter protects a setup flow reached with a fresh
 *   session. This path requires an authenticated owner or store manager with RETAIL enabled, and
 *   rate-limiting by IP would punish a busy back office rather than an attacker.
 * - **`OnboardingStepAdvanced` audit.** No step advanced, so recording one would be a lie.
 */

/** A terminal as it is safe to hand back. Carries no credential of any kind. */
export interface ProvisionedPosDevice {
  id: string;
  name: string;
  code: string;
  storeId: string;
  /** Always this, for a terminal that has not been paired yet. */
  status: "PENDING_ACTIVATION";
}

export interface ProvisionPosDeviceInput {
  tenantId: string;
  storeId: string;
  actorUserId: string;
  name: string;
  code: string;
  correlationId: string;
  receiptHeader?: string | null;
  receiptFooter?: string | null;
  showProductImages: boolean;
  scanSoundEnabled: boolean;
  cashDrawerEnabled: boolean;
}

export interface ProvisionPosDeviceOutput {
  device: ProvisionedPosDevice;
  /** Shown once, to the person standing at the terminal. Never stored, never logged. */
  pairingCode: string;
  pairingExpiresAt: Date;
}

/**
 * Create the terminal row, issue its pairing code, and enqueue the domain event.
 *
 * Takes a `Prisma.TransactionClient` rather than reaching for the global client, so the event
 * commits with the device or not at all. A `PosDeviceCreated` event for a device that was rolled
 * back would send every downstream consumer after a terminal that does not exist.
 *
 * The caller owns authorization and any lifecycle concerns of its own. This function decides
 * nothing about who may call it.
 */
export async function provisionPosDevice(
  tx: Prisma.TransactionClient,
  input: ProvisionPosDeviceInput,
): Promise<ProvisionPosDeviceOutput> {
  const code = input.code.trim().toUpperCase();
  const pairingCode = generatePairingCode();
  const pairingExpiresAt = new Date(Date.now() + env.POS_PAIRING_TTL_MINUTES * 60 * 1000);

  const created = await tx.posDevice.create({
    data: {
      tenantId: input.tenantId,
      storeId: input.storeId,
      name: input.name.trim(),
      code,
      createdByUserId: input.actorUserId,
      // Only the hash is stored. The code itself is returned once and never persisted.
      pairingCodeHash: hashPairingCode(pairingCode),
      pairingExpiresAt,
      receiptHeader: input.receiptHeader?.trim() || null,
      receiptFooter: input.receiptFooter?.trim() || null,
      showProductImages: input.showProductImages,
      scanSoundEnabled: input.scanSoundEnabled,
      cashDrawerEnabled: input.cashDrawerEnabled,
    },
  });

  // The payload carries ids and configuration only. A pairing code is a live credential and must
  // never enter an event body, which is replayable and readable by every future consumer.
  await enqueueOutboxEvent(tx, {
    tenantId: input.tenantId,
    storeId: input.storeId,
    eventType: "PosDeviceCreated",
    actorUserId: input.actorUserId,
    correlationId: input.correlationId,
    entityId: created.id,
    payload: {
      code: created.code,
      name: created.name,
      storeId: input.storeId,
      status: "PENDING_ACTIVATION",
    },
  });

  return {
    device: {
      id: created.id,
      name: created.name,
      code: created.code,
      storeId: input.storeId,
      status: "PENDING_ACTIVATION",
    },
    pairingCode: formatPairingCode(pairingCode),
    pairingExpiresAt,
  };
}

export interface CreatePosDeviceActor {
  tenantId: string;
  userId: string;
  tenantRole: "OWNER" | "STAFF";
  membershipRole: string | null;
  /** From the caller's resolved POS context. There is no store parameter — see below. */
  storeId: string;
}

export type CreatePosDeviceResult =
  | { status: "ok"; device: ProvisionedPosDevice; pairingCode: string; pairingExpiresAt: Date }
  | { status: "forbidden" }
  | { status: "validation_error"; field: string; reason: string }
  /** A terminal with that code already exists in this store. */
  | { status: "conflict"; reason: string }
  | { status: "capability_disabled"; capability: Capability };

/** A terminal name on the floor: POS-01, TILL-2, COUNTER-A. Short, typed by a person. */
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,15}$/;

/**
 * Add a terminal to the caller's own store, at any point in the tenant's life.
 *
 * **There is no store parameter, and that absence is the isolation guarantee.** The store comes
 * from the caller's resolved POS context, exactly as `listPosDevices` does it, so there is
 * nowhere for a client to put another tenant's — or another store's — identifier. The onboarding
 * path accepts a `storeId` because during setup no POS context exists yet; here one always does,
 * and accepting one anyway would add an attack surface to buy nothing.
 *
 * Gated on RETAIL at this boundary, so a direct HTTP call is refused exactly as a click would be.
 */
export async function createPosDevice(params: {
  actor: CreatePosDeviceActor;
  name: string;
  code: string;
  receiptHeader?: string | null;
  receiptFooter?: string | null;
  showProductImages?: boolean;
  scanSoundEnabled?: boolean;
  cashDrawerEnabled?: boolean;
  correlationId: string;
}): Promise<CreatePosDeviceResult> {
  const { tenantId, storeId } = params.actor;

  const gate = await requireCapability(tenantId, Capability.RETAIL);
  if (gate.status !== "ok") {
    return { status: "capability_disabled", capability: gate.capability };
  }

  // The same predicate the onboarding path uses — OWNER, or a STORE_MANAGER of this store.
  // Configuring a terminal is not a till operation: a cashier may sell on one and may not
  // create one. No new permission is introduced.
  if (
    !canConfigurePos({
      tenantRole: params.actor.tenantRole,
      // The store came from the caller's own session, so it belongs to their tenant by
      // construction; there is no id here that could have come from anywhere else.
      storeBelongsToTenant: true,
      membershipRole: params.actor.membershipRole,
    })
  ) {
    await writeAuditLog({
      tenantId,
      userId: params.actor.userId,
      action: "PosDeviceSetupForbidden",
      correlationId: params.correlationId,
      metadata: { storeId },
    });
    return { status: "forbidden" };
  }

  const name = params.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 60) {
    return {
      status: "validation_error",
      field: "name",
      reason: "Give the terminal a name of 2 to 60 characters.",
    };
  }

  const code = params.code.trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) {
    return {
      status: "validation_error",
      field: "code",
      reason: "Use a short code of letters, digits and hyphens, such as POS-02.",
    };
  }

  try {
    const provisioned = await db.$transaction((tx) =>
      provisionPosDevice(tx, {
        tenantId,
        storeId,
        actorUserId: params.actor.userId,
        name,
        code,
        correlationId: params.correlationId,
        receiptHeader: params.receiptHeader ?? null,
        receiptFooter: params.receiptFooter ?? null,
        showProductImages: params.showProductImages ?? true,
        scanSoundEnabled: params.scanSoundEnabled ?? true,
        cashDrawerEnabled: params.cashDrawerEnabled ?? false,
      }),
    );

    // Audit rides the existing trail. Metadata carries ids and the *fact* a pairing code was
    // issued — never the code. Written outside the transaction like every other audit call
    // here; that inherited trade-off is documented on `writeAuditLog` and unchanged.
    await writeAuditLog({
      tenantId,
      userId: params.actor.userId,
      action: "PosDeviceCreated",
      correlationId: params.correlationId,
      metadata: { posDeviceId: provisioned.device.id, storeId, code },
    });
    await writeAuditLog({
      tenantId,
      userId: params.actor.userId,
      action: "PosDevicePairingCodeIssued",
      correlationId: params.correlationId,
      metadata: {
        posDeviceId: provisioned.device.id,
        expiresAt: provisioned.pairingExpiresAt.toISOString(),
      },
    });

    return {
      status: "ok",
      device: provisioned.device,
      pairingCode: provisioned.pairingCode,
      pairingExpiresAt: provisioned.pairingExpiresAt,
    };
  } catch (err) {
    // `@@unique([storeId, code])` is what makes concurrent creation safe: two requests naming
    // one code both reach the insert, and PostgreSQL decides. The loser is a plain conflict,
    // not a crash, and no second terminal exists.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return {
        status: "conflict",
        reason: `A terminal with the code ${code} already exists in this store.`,
      };
    }
    throw err;
  }
}
