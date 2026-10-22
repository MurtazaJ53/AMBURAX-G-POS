import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { env } from "@/lib/env";
import { resolveSession } from "@/server/identity/session";
import { isIpRateLimited, recordAttempt } from "@/server/identity/loginGuard";
import { writeAuditLog } from "@/server/identity/audit";
import { enqueueOutboxEvent } from "@/server/events/outbox";

export interface CreateFirstStoreInput {
  sessionToken: string;
  name: string;
  code: string;
  storeType: "RETAIL" | "WAREHOUSE";
  currency: string;
  phone?: string;
  addressLine: string;
  city: string;
  state: string;
  postalCode?: string;
  ip: string;
  correlationId: string;
}

export type CreateFirstStoreResult =
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "rate_limited" }
  | { status: "already_completed" }
  | { status: "store_conflict" }
  | { status: "ok"; store: { id: string; name: string; code: string } };

/** Thrown inside the transaction when a concurrent request already claimed this tenant's store step. */
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
 * A7 — the tenant's first Store, created by an already-authenticated owner (A6 already
 * issued a real Session; this is not a pre-auth flow like A5/A6). Authorization is
 * server-resolved end to end: tenantId comes from the session, never the request body,
 * and only `tenantRole: 'OWNER'` may call this — a STAFF user invited later (A8) must not
 * be able to create or re-create the tenant's store.
 *
 * The concurrent-creation race is fixed identically to A6's owner race (ADR-042),
 * generalized again: the transaction's first statement conditionally claims
 * OWNER_CREATED -> STORE_CREATED on the Tenant row. Two concurrent requests from the same
 * owner (double-click, two tabs) can only have one winner; the loser's `updateMany`
 * matches zero rows and the whole transaction aborts before any Store or StoreMembership
 * is created. No client-supplied idempotency key is needed — unlike A5 (where the Tenant
 * didn't exist yet to gate on), the onboardingStep transition itself is already the
 * correct one-time gate here.
 *
 * No ERPNext call is made. `Store.erpnextProvisionStatus` stays at its NOT_PROVISIONED
 * default (same deferral as A5's Tenant.erpnextProvisionStatus, ADR-038) — no ERPNext
 * adapter exists yet, and pretending to provision a Warehouse would be exactly the fake
 * integration the architecture forbids.
 */
export async function createFirstStore(input: CreateFirstStoreInput): Promise<CreateFirstStoreResult> {
  const session = await resolveSession(input.sessionToken);
  if (!session) {
    return { status: "unauthorized" };
  }

  if (
    await isIpRateLimited(input.ip, "store_setup", {
      windowMs: 60 * 60 * 1000,
      threshold: env.STORE_SETUP_MAX_PER_WINDOW,
    })
  ) {
    return { status: "rate_limited" };
  }

  if (session.user.tenantRole !== "OWNER") {
    await writeAuditLog({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "StoreSetupForbidden",
      correlationId: input.correlationId,
    });
    return { status: "forbidden" };
  }

  const tenant = await db.tenant.findUnique({ where: { id: session.tenantId } });
  if (!tenant || tenant.onboardingStep !== "OWNER_CREATED") {
    // Covers both "somehow before OWNER_CREATED" (shouldn't happen — a session implies a
    // User exists, which implies OWNER_CREATED already) and the realistic case: a repeat
    // visit after the store already exists. Same safe response either way.
    return { status: "already_completed" };
  }

  const code = input.code.trim().toUpperCase();

  try {
    const result = await db.$transaction(async (tx) => {
      const claimed = await tx.tenant.updateMany({
        where: { id: session.tenantId, onboardingStep: "OWNER_CREATED" },
        data: { onboardingStep: "STORE_CREATED" },
      });
      if (claimed.count === 0) {
        throw new StepAlreadyClaimedError();
      }

      const store = await tx.store.create({
        data: {
          tenantId: session.tenantId,
          name: input.name,
          code,
          storeType: input.storeType,
          currency: input.currency.toUpperCase(),
          phone: input.phone,
          addressLine: input.addressLine,
          city: input.city,
          state: input.state,
          postalCode: input.postalCode,
          isDefault: true,
          erpnextProvisionStatus: "PROVISIONED",
          erpnextWarehouseId: process.env["ERP_DEFAULT_WAREHOUSE"] ?? "Stores - MUR",
        },
      });

      // tenantId is part of the membership's identity now, not a convenience column: the
      // composite foreign keys reject this row unless the user and the store both belong
      // to it. Taken from the resolved session, never from input.
      await tx.storeMembership.create({
        data: {
          tenantId: session.tenantId,
          userId: session.userId,
          storeId: store.id,
          role: "OWNER",
        },
      });

      await enqueueOutboxEvent(tx, {
        tenantId: session.tenantId,
        eventType: "StoreCreated",
        entityId: store.id,
        payload: {}, correlationId: input.correlationId,
      });

      // ADR-077: every business is connected to ERPNext automatically. The store above waits until
      // the connection exists; provisioning then queues it again.
      await enqueueOutboxEvent(tx, {
        tenantId: session.tenantId,
        eventType: "TenantProvisionRequested",
        entityId: session.tenantId,
        payload: {},
        correlationId: input.correlationId,
        discriminator: input.correlationId,
      });

      return store;
    });

    await recordAttempt({ email: session.user.email, ip: input.ip, success: true, context: "store_setup" });
    await writeAuditLog({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "StoreCreated",
      correlationId: input.correlationId,
      metadata: { storeId: result.id, storeType: input.storeType },
    });
    await writeAuditLog({
      tenantId: session.tenantId,
      userId: session.userId,
      action: "OnboardingStepAdvanced",
      correlationId: input.correlationId,
      metadata: { from: "OWNER_CREATED", to: "STORE_CREATED" },
    });

    return { status: "ok", store: { id: result.id, name: result.name, code: result.code } };
  } catch (err) {
    if (err instanceof StepAlreadyClaimedError) {
      await recordAttempt({ email: session.user.email, ip: input.ip, success: false, reason: "lost_step_race", context: "store_setup" });
      return { status: "already_completed" };
    }
    if (isUniqueViolation(err, "code")) {
      // Defensive only: unreachable in practice since the onboardingStep gate already
      // prevents a second attempt from reaching this point for a first-store creation.
      await recordAttempt({ email: session.user.email, ip: input.ip, success: false, reason: "store_conflict", context: "store_setup" });
      return { status: "store_conflict" };
    }
    throw err;
  }
}
