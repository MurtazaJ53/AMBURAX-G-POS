import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAuditLog } from "@/server/identity/audit";
import {
  ALL_CAPABILITIES,
  Capability,
  DEFAULT_CAPABILITIES,
} from "@/server/capability/capabilities";

/**
 * The one place that reads and writes tenant capability state.
 *
 * Every domain service asks this module; none of them queries `tenant_capabilities` directly.
 * That is not tidiness. A capability check scattered into twelve services becomes twelve
 * slightly different checks, and the one that forgets `enabled === false`, or that treats a
 * missing row as permissive, is a hole nobody finds by reading any single file.
 *
 * ## What a check answers
 *
 *     hasCapability(tenantId, capability) -> boolean
 *
 * True only when a row exists AND `enabled` is true. A missing row is false. This is the
 * deliberate direction: the safe failure mode for "we have no idea" is "no", and a capability
 * that appears after a partial migration must not switch a module on by accident. Defaults are
 * granted explicitly, by `seedDefaultCapabilities` and by the P1-8F backfill — never by the
 * absence of data meaning yes.
 *
 * ## Ordering against permission
 *
 * `requireCapability` answers a tenant-level question and knows nothing about users. Callers
 * still run their own authorization; see `capabilities.ts` for why both must pass.
 *
 * ## Who may change configuration
 *
 * Tenant OWNER, and only tenant OWNER. Not `canManageInventory` — a store manager who may
 * define units and move stock has no business switching a whole business module on for the
 * company. Capabilities are tenant-wide configuration, so the authority is the tenant-wide
 * role. This is the strongest role the existing model has (`TenantRole` is OWNER | STAFF); no
 * new role, permission matrix or RBAC layer is introduced here.
 *
 * ## tenantId
 *
 * Always from authenticated server context. Every function here takes a `tenantId` that its
 * callers read from the resolved session, never from a body, query string, URL segment or
 * client-held state. Nothing in this module accepts a caller-chosen tenant.
 */

export interface CapabilityActor {
  tenantId: string;
  userId: string;
  tenantRole: "OWNER" | "STAFF";
}

/** Only the tenant owner configures capabilities. See the module comment. */
export function canManageCapabilities(actor: { tenantRole: "OWNER" | "STAFF" }): boolean {
  return actor.tenantRole === "OWNER";
}

/**
 * Is this capability on for this tenant?
 *
 * Row absent -> false. Row present with `enabled = false` -> false. Both mean "off" to every
 * caller; the table keeps them distinct only so that disabling does not erase the history of
 * having been enabled.
 */
export async function hasCapability(tenantId: string, capability: Capability): Promise<boolean> {
  const row = await db.tenantCapability.findUnique({
    where: { tenantId_capability: { tenantId, capability } },
    select: { enabled: true },
  });
  return row?.enabled === true;
}

export type CapabilityGateResult =
  | { status: "ok" }
  | { status: "capability_disabled"; capability: Capability };

/**
 * The reusable gate. Domain services call this and return its refusal upward.
 *
 * The refusal names the capability, and that is an in-process detail only. At the HTTP boundary
 * it is flattened to a plain not-found, per the P1-7 freeze: "a disabled capability produces the
 * same response as an unknown route, not a permission error", because whether a tenant has a
 * module is not something their API surface should volunteer. Routes mapping this result must
 * not pass the capability name outward. See docs/architecture/CAPABILITIES.md.
 */
export async function requireCapability(
  tenantId: string,
  capability: Capability,
): Promise<CapabilityGateResult> {
  const enabled = await hasCapability(tenantId, capability);
  return enabled ? { status: "ok" } : { status: "capability_disabled", capability };
}

export interface CapabilityState {
  capability: Capability;
  enabled: boolean;
}

/**
 * Every capability with its current state for one tenant — including the ones with no row,
 * reported as disabled. A caller asking "what does this tenant have" wants the whole picture,
 * and returning only the configured rows would make "off" and "never mentioned" look different
 * to a reader when they are the same to the gate.
 */
export async function listCapabilities(tenantId: string): Promise<CapabilityState[]> {
  const rows = await db.tenantCapability.findMany({
    where: { tenantId },
    select: { capability: true, enabled: true },
  });
  const byCapability = new Map(rows.map((row) => [row.capability, row.enabled]));
  return ALL_CAPABILITIES.map((capability) => ({
    capability,
    enabled: byCapability.get(capability) === true,
  }));
}

export type SetCapabilityResult =
  | { status: "ok"; capability: Capability; enabled: boolean; changed: boolean }
  | { status: "forbidden" };

/**
 * Switch a capability on or off for the actor's own tenant.
 *
 * Upsert rather than read-then-insert: two owners toggling the same capability at once would
 * otherwise race between the read and the write, and the loser would hit a raw unique violation.
 * The unique index on `(tenantId, capability)` is what makes the upsert safe, and it is the same
 * index that makes a duplicate row impossible.
 *
 * `changed` reports whether this call actually altered the state, so a replayed request is
 * distinguishable from a real flip without either being an error. Disabling is an update, never
 * a delete.
 */
export async function setCapability(params: {
  actor: CapabilityActor;
  capability: Capability;
  enabled: boolean;
  correlationId: string;
}): Promise<SetCapabilityResult> {
  if (!canManageCapabilities(params.actor)) return { status: "forbidden" };

  const { tenantId } = params.actor;

  const before = await db.tenantCapability.findUnique({
    where: { tenantId_capability: { tenantId, capability: params.capability } },
    select: { enabled: true },
  });

  const row = await db.tenantCapability.upsert({
    where: { tenantId_capability: { tenantId, capability: params.capability } },
    create: { tenantId, capability: params.capability, enabled: params.enabled },
    update: { enabled: params.enabled },
    select: { enabled: true },
  });

  const changed = before?.enabled !== row.enabled;

  // Capability changes ride the existing AuditLog trail — the same "who did what" record every
  // other configuration change writes. No new audit system. Its known limitation is inherited
  // and real: `writeAuditLog` uses the global client, so the row is written outside the
  // mutation's transaction and the two can disagree if the process dies between them.
  if (changed) {
    await writeAuditLog({
      tenantId,
      userId: params.actor.userId,
      action: row.enabled ? "TenantCapabilityEnabled" : "TenantCapabilityDisabled",
      correlationId: params.correlationId,
      metadata: { capability: params.capability },
    });
  }

  return { status: "ok", capability: params.capability, enabled: row.enabled, changed };
}

/**
 * Grant a new tenant its default capabilities, inside the caller's transaction.
 *
 * Takes a `Prisma.TransactionClient` rather than reaching for the global client, so the grant
 * commits with the tenant itself. A tenant that exists without its capabilities is a tenant
 * whose POS is switched off, and that must not be a state a crash can produce.
 *
 * `skipDuplicates` makes a replay harmless. The same list drives the P1-8F backfill, so
 * registration and migration cannot drift apart.
 */
export async function seedDefaultCapabilities(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  await tx.tenantCapability.createMany({
    data: DEFAULT_CAPABILITIES.map((capability) => ({ 
      id: randomUUID(),
      tenantId, 
      capability, 
      enabled: true 
    })),
    skipDuplicates: true,
  });
}
