import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { isIpRateLimited, recordAttempt } from "@/server/identity/loginGuard";
import { writeAuditLog } from "@/server/identity/audit";
import { canConfigurePos } from "@/server/pos/posRoles";
import { provisionPosDevice } from "@/server/pos/posDeviceProvisioning";

/**
 * A9 — the store's first POS terminal.
 *
 * Two operations live here because the A9 wireframe has both [Skip] and [Continue],
 * exactly as A8's did. That settles the same product question ADR-053 settled for the
 * team step: POS_CONFIGURED means "the POS step was completed", not "at least one
 * terminal exists". A warehouse-only tenant, or a merchant who will pair tills next week,
 * must be able to finish onboarding.
 */

export interface CreateFirstPosDeviceInput {
  sessionToken: string;
  storeId: string;
  name: string;
  code: string;
  receiptHeader?: string;
  receiptFooter?: string;
  showProductImages: boolean;
  scanSoundEnabled: boolean;
  cashDrawerEnabled: boolean;
  ip: string;
  correlationId: string;
}

export type CreateFirstPosDeviceResult =
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "rate_limited" }
  | { status: "wrong_step" }
  | { status: "store_not_found" }
  | { status: "device_conflict" }
  | {
      status: "ok";
      device: { id: string; name: string; code: string; status: "PENDING_ACTIVATION" };
      // Raw, returned exactly once, to the authenticated owner/manager who just created
      // the terminal. Never persisted, never logged, never recoverable afterwards.
      pairingCode: string;
      pairingExpiresAt: string;
    };

export type CompletePosStepResult =
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "rate_limited" }
  | { status: "already_completed" }
  | { status: "ok" };

/** Thrown inside the transaction when a concurrent request already claimed the POS step. */
class StepAlreadyClaimedError extends Error {}

// A9 is reachable from two legitimate predecessor states, and enforcing only one of them
// would make onboarding uncompletable for a tenant that used A8's Skip button:
//   A7 -> A8 Skip     -> tenant sits at STORE_CREATED
//   A7 -> A8 Continue -> tenant sits at TEAM_INVITED
const POS_STEP_PREDECESSORS = ["STORE_CREATED", "TEAM_INVITED"] as const;

function isUniqueViolation(err: unknown, field: string): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    Array.isArray(err.meta?.target) &&
    (err.meta!.target as string[]).includes(field)
  );
}

/**
 * Creates the terminal and claims TEAM_INVITED|STORE_CREATED -> POS_CONFIGURED in one
 * transaction, claim first (ADR-031/042/049/059, generalized once more). The claiming
 * `updateMany` is the first statement, so it locks the Tenant row for the transaction's
 * life: a concurrent second submit blocks, then matches zero rows, then rolls back having
 * created no device, no pairing code, and no audit entry. Two tabs with *different* device
 * codes therefore cannot both win — which `@@unique([storeId, code])` alone would not have
 * prevented.
 *
 * The unique constraint is still load-bearing, for the other race: two submits with the
 * *same* code. It is also what will protect the future multi-POS path (screen 74), which
 * will create terminals without any onboarding step to claim.
 *
 * No ERPNext call. A POS terminal is not an ERPNext document — ERPNEXT_COVERAGE.md puts
 * POS in "ERPNext foundation + Amburax UX", and the authoritative ERPNext objects for a
 * till are the Sales Invoices it will later post, not the till itself. Deliberately no
 * `erpnextProvisionStatus` column on PosDevice: there is no provisioning pipeline planned
 * for it, and adding the field would imply one exists.
 */
export async function createFirstPosDevice(
  input: CreateFirstPosDeviceInput,
): Promise<CreateFirstPosDeviceResult> {
  const session = await resolveSession(input.sessionToken);
  if (!session) {
    return { status: "unauthorized" };
  }

  if (
    await isIpRateLimited(input.ip, "pos_setup", {
      windowMs: 60 * 60 * 1000,
      threshold: env.POS_SETUP_MAX_PER_WINDOW,
    })
  ) {
    return { status: "rate_limited" };
  }

  // Store is looked up by id *and* tenant, so a cross-tenant storeId is indistinguishable
  // from a nonexistent one — no existence oracle for another tenant's store ids.
  const store = await db.store.findFirst({
    where: { id: input.storeId, tenantId: session.tenantId },
    select: { id: true },
  });
  if (!store) {
    await recordAttempt({
      email: session.user.email,
      ip: input.ip,
      success: false,
      reason: "store_not_found",
      context: "pos_setup",
    });
    return { status: "store_not_found" };
  }

  const membership = await db.storeMembership.findUnique({
    where: { userId_storeId: { userId: session.userId, storeId: store.id } },
    select: { role: true },
  });

  if (
    !canConfigurePos({
      tenantRole: session.user.tenantRole,
      storeBelongsToTenant: true,
      membershipRole: membership?.role ?? null,
    })
  ) {
    await writeAuditLog({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "PosDeviceSetupForbidden",
      correlationId: input.correlationId,
      metadata: { storeId: store.id },
    });
    await recordAttempt({
      email: session.user.email,
      ip: input.ip,
      success: false,
      reason: "forbidden",
      context: "pos_setup",
    });
    return { status: "forbidden" };
  }

  const code = input.code.trim().toUpperCase();

  try {
    const provisioned = await db.$transaction(async (tx) => {
      const claimed = await tx.tenant.updateMany({
        where: { id: session.tenantId, onboardingStep: { in: [...POS_STEP_PREDECESSORS] } },
        data: { onboardingStep: "POS_CONFIGURED" },
      });
      if (claimed.count === 0) {
        throw new StepAlreadyClaimedError();
      }

      // The row, the pairing code and the domain event now come from the shared primitive, so
      // this path and the post-onboarding one cannot drift apart. What stays here is the part
      // that is genuinely onboarding's: the step claim above.
      return provisionPosDevice(tx, {
        tenantId: session.tenantId,
        storeId: store.id,
        actorUserId: session.userId,
        name: input.name,
        code,
        correlationId: input.correlationId,
        receiptHeader: input.receiptHeader,
        receiptFooter: input.receiptFooter,
        showProductImages: input.showProductImages,
        scanSoundEnabled: input.scanSoundEnabled,
        cashDrawerEnabled: input.cashDrawerEnabled,
      });
    });

    await recordAttempt({ email: session.user.email, ip: input.ip, success: true, context: "pos_setup" });
    // Metadata carries ids and the *fact* a pairing code was issued — never the code.
    await writeAuditLog({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "PosDeviceCreated",
      correlationId: input.correlationId,
      metadata: { posDeviceId: provisioned.device.id, storeId: store.id, code },
    });
    await writeAuditLog({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "PosDevicePairingCodeIssued",
      correlationId: input.correlationId,
      metadata: {
        posDeviceId: provisioned.device.id,
        expiresAt: provisioned.pairingExpiresAt.toISOString(),
      },
    });
    await writeAuditLog({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "OnboardingStepAdvanced",
      correlationId: input.correlationId,
      metadata: { to: "POS_CONFIGURED" },
    });

    return {
      status: "ok",
      // Rebuilt field by field rather than passed through: the shared primitive also reports
      // the store, and this response has never carried one. A refactor is not a licence to
      // change an endpoint's shape.
      device: {
        id: provisioned.device.id,
        name: provisioned.device.name,
        code: provisioned.device.code,
        status: provisioned.device.status,
      },
      pairingCode: provisioned.pairingCode,
      pairingExpiresAt: provisioned.pairingExpiresAt.toISOString(),
    };
  } catch (err) {
    if (err instanceof StepAlreadyClaimedError) {
      await recordAttempt({
        email: session.user.email,
        ip: input.ip,
        success: false,
        reason: "lost_step_race",
        context: "pos_setup",
      });
      return { status: "wrong_step" };
    }
    if (isUniqueViolation(err, "code")) {
      await recordAttempt({
        email: session.user.email,
        ip: input.ip,
        success: false,
        reason: "device_conflict",
        context: "pos_setup",
      });
      return { status: "device_conflict" };
    }
    throw err;
  }
}

/**
 * A9's Skip path. Same single-statement atomic claim as `completeTeamStep` (ADR-053):
 * one conditional `updateMany`, no transaction to roll back, and accepting either
 * legitimate predecessor step so a tenant that skipped A8 is not stranded.
 */
export async function completePosStep(params: {
  sessionToken: string;
  ip: string;
  correlationId: string;
}): Promise<CompletePosStepResult> {
  const session = await resolveSession(params.sessionToken);
  if (!session) {
    return { status: "unauthorized" };
  }

  if (
    await isIpRateLimited(params.ip, "pos_step", {
      windowMs: 60 * 60 * 1000,
      threshold: env.POS_STEP_MAX_PER_WINDOW,
    })
  ) {
    return { status: "rate_limited" };
  }

  // Skipping the step is a tenant-level onboarding decision, not a store operation, so
  // this one *is* owner-only — unlike creating a terminal, which a store manager may do.
  if (session.user.tenantRole !== "OWNER") {
    return { status: "forbidden" };
  }

  const claimed = await db.tenant.updateMany({
    where: { id: session.tenantId, onboardingStep: { in: [...POS_STEP_PREDECESSORS] } },
    data: { onboardingStep: "POS_CONFIGURED" },
  });

  if (claimed.count === 0) {
    return { status: "already_completed" };
  }

  await writeAuditLog({
    tenantId: session.tenantId,
    userId: session.userId,
    action: "OnboardingStepAdvanced",
    correlationId: params.correlationId,
    metadata: { to: "POS_CONFIGURED", skippedPosDevice: true },
  });

  return { status: "ok" };
}
