import { db } from "@/server/db";
import { ErpError } from "@/server/erp/errors";

/**
 * Resolving a tenant to the ERPNext environment that serves it, and obtaining credentials for
 * it without ever putting those credentials in the database.
 *
 * ## The mapping the architecture froze
 *
 *     AMBURAX Tenant  ->  ERPNext Site  ->  ERPNext Company
 *
 * One tenant, one site, one database, by default. A tenant may later need more than one company
 * inside its site — a group with two legal entities — so `companyId` is a separate, optional
 * field rather than an assumption baked into the site.
 *
 * What this deliberately is NOT: one ERP cluster per tenant (unaffordable), and one shared ERP
 * site for every tenant (a single blast radius across every customer's ledger). Many sites share
 * a pool; `clusterId` names which pool, so a placement manager can later move a large tenant to
 * dedicated capacity without any domain code knowing it happened.
 *
 * ## Where this data lives
 *
 * Entirely in columns that already exist. `Tenant.erpnextSiteId` and
 * `Tenant.erpnextProvisionStatus` were reserved by earlier phases for exactly this, and this
 * phase reads them rather than inventing a table. No migration was required — see
 * docs/architecture/ERP_ADAPTER.md.
 *
 * ## Secrets are not in this data
 *
 * No password, API key or token is stored in PostgreSQL, and none appears in the persisted
 * types. Credentials are obtained through `ErpCredentialProvider`, an interface whose only
 * shipped implementation reads from the process environment. When a real secret manager exists
 * it implements this interface and nothing else changes.
 */

/** Where a tenant's ERP lives. Contains no secret of any kind. */
export interface ErpEnvironment {
  tenantId: string;
  /** Opaque site identifier. Not a URL — resolving it to a host is the transport's job. */
  siteId: string;
  /** Which infrastructure pool hosts the site. Null until a placement manager assigns one. */
  clusterId: string | null;
  /** The ERP company a tenant's documents post to, when the site holds more than one. */
  companyId: string | null;
  /** Version reported by configuration, asserted against the site on connect. */
  version: string | null;
}

export type ResolveErpEnvironmentResult =
  | { status: "ok"; environment: ErpEnvironment }
  /** The tenant exists but has no ERP site yet. A provisioning gap, not a failure. */
  | { status: "not_provisioned" }
  /** The tenant does not exist. */
  | { status: "not_found" };

/**
 * Resolve the ERP environment for one tenant.
 *
 * `tenantId` must come from authenticated server context. There is no code path here that
 * accepts a site id, cluster id or company id from a caller — a tenant can only ever reach the
 * environment its own row names, which is what makes cross-tenant ERP access impossible through
 * normal resolution rather than merely discouraged.
 */
export async function resolveErpEnvironment(
  tenantId: string,
): Promise<ResolveErpEnvironmentResult> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, erpnextSiteId: true, erpnextProvisionStatus: true, erpnextCompanyId: true },
  });
  if (!tenant) return { status: "not_found" };

  // PROVISIONED is the only status that means a site is usable. NOT_PROVISIONED, PROVISIONING
  // and FAILED all mean "there is nothing to talk to yet", and saying so plainly is better than
  // letting a caller discover it as a connection error.
  if (tenant.erpnextProvisionStatus !== "PROVISIONED" || !tenant.erpnextSiteId) {
    return { status: "not_provisioned" };
  }

  return {
    status: "ok",
    environment: {
      tenantId: tenant.id,
      siteId: tenant.erpnextSiteId,
      // Placement is a later phase. Null is the honest value, not a default pool invented here.
      clusterId: null,
      // Set by provisioning (ADR-077/078). Null means "not linked yet" — callers that post documents
      // must refuse (requireCompany), never substitute a company by name.
      companyId: tenant.erpnextCompanyId ?? null,
      version: null,
    },
  };
}

/**
 * How the adapter obtains credentials for a site.
 *
 * An interface rather than an implementation, because the only correct production answer is a
 * real secret manager and this phase does not build one. The environment-variable version below
 * is enough for development and for tests, and it fails loudly rather than defaulting when a
 * site has no credentials — a silent fallback here would mean unauthenticated calls to
 * somebody's accounting system.
 */
export interface ErpCredentials {
  /** Base URL of the site. Held only in memory, never logged, never persisted. */
  baseUrl: string;
  apiKey: string;
  apiSecret: string;
}

export interface ErpCredentialProvider {
  credentialsFor(environment: ErpEnvironment): Promise<ErpCredentials>;
}

/**
 * Reads credentials from the process environment, keyed by site id.
 *
 * Expected variables per site: `ERP_SITE_<SITEID>_URL`, `_KEY`, `_SECRET`, with the site id
 * uppercased and non-alphanumerics replaced by underscores.
 *
 * Explicitly a development and test mechanism, documented as such rather than presented as a
 * secret store: an environment variable is visible to anything that can read the process, which
 * is acceptable on a developer's machine and not in production.
 */
export class EnvErpCredentialProvider implements ErpCredentialProvider {
  async credentialsFor(environment: ErpEnvironment): Promise<ErpCredentials> {
    const slug = environment.siteId.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const baseUrl = process.env[`ERP_SITE_${slug}_URL`];
    const apiKey = process.env[`ERP_SITE_${slug}_KEY`];
    const apiSecret = process.env[`ERP_SITE_${slug}_SECRET`];

    if (!baseUrl || !apiKey || !apiSecret) {
      // Names the site, never the variable's contents. Which site is unconfigured is useful;
      // what the value should have been is not something an error message may discuss.
      throw new ErpError({
        kind: "configuration_error",
        message: `No ERP credentials are configured for site ${environment.siteId}.`,
      });
    }

    return { baseUrl, apiKey, apiSecret };
  }
}
