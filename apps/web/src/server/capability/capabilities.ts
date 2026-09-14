/**
 * The capability vocabulary. No database, no session, no I/O — just the list and what a new
 * tenant starts with.
 *
 * ## Capability is not permission
 *
 * This is the most important distinction in this module, and getting it backwards produces a
 * security hole that looks like a working feature:
 *
 *     capability -> "does this TENANT have this business module?"
 *     permission -> "is this USER allowed to perform this action?"
 *
 * Both must pass. A tenant with WHOLESALE enabled and a cashier with no authority to create
 * wholesale orders is a refusal, and that refusal comes from the existing authorization code,
 * not from here. Nothing in this module grants anyone anything.
 *
 * ## Identifiers
 *
 * The enum member names are the identifiers, everywhere: the database column, the backend
 * check, the API response, the audit metadata, and eventually the frontend. They are never
 * display labels — a label gets translated, retitled and shortened by whoever owns the screen,
 * and an authorization key that changes when a designer renames a menu item is not a key.
 * Rendering "Job Work" for JOB_WORK is the caller's business.
 */

import { Capability } from "@prisma/client";

export { Capability };

/**
 * Every capability, in the order the architecture lists them. Used to render the full on/off
 * picture for a tenant, so a capability with no row still appears — as disabled, which is what
 * it is.
 */
export const ALL_CAPABILITIES: readonly Capability[] = [
  Capability.RETAIL,
  Capability.WHOLESALE,
  Capability.MANUFACTURING,
  Capability.JOB_WORK,
  Capability.PROCUREMENT,
  Capability.COMMERCE,
  Capability.DISTRIBUTION,
] as const;

/**
 * What a newly registered tenant gets.
 *
 * RETAIL only, and deliberately not derived from `Tenant.businessType`. Every tenant can ring
 * up a sale from the moment onboarding finishes, whatever business type they picked at
 * registration, so RETAIL is the capability that describes what actually works. This is the
 * same list the P1-8F migration backfilled onto existing tenants, which is why a tenant
 * registered last month and one registered tomorrow look identical to the gate.
 *
 * Nothing else is granted. WHOLESALE, MANUFACTURING, JOB_WORK, PROCUREMENT, COMMERCE and
 * DISTRIBUTION have no implementation behind them yet; enabling one by default would assert a
 * module the tenant cannot use. They get switched on deliberately, by an owner, when they mean
 * something.
 */
export const DEFAULT_CAPABILITIES: readonly Capability[] = [Capability.RETAIL] as const;

/** Is this arbitrary string one of the capability identifiers? Used at the API boundary. */
export function isCapability(value: unknown): value is Capability {
  return typeof value === "string" && (ALL_CAPABILITIES as readonly string[]).includes(value);
}
