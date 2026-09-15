import type { ErpClient } from "@/server/erp/client";
import { resolveErpEnvironment } from "@/server/erp/config";
import { ErpError } from "@/server/erp/errors";

/**
 * Is a tenant's ERP reachable, and if not, why not?
 *
 * The states are deliberately distinct rather than a boolean, because the operational response
 * to each differs: `not_provisioned` is a provisioning queue item, `misconfigured` is a
 * deployment defect, `unavailable` is wait-and-retry, and `unsupported` is an upgrade decision.
 * Collapsing them into "down" throws away the only information that tells anyone what to do.
 *
 * **This never mutates ERPNext.** It issues one read — Frappe's ping method — and nothing else.
 * A health check that writes is a health check that cannot be run often, and one that creates
 * documents is an outage of its own.
 */

export type ErpHealthState =
  /** No site assigned yet. Expected for every tenant today. */
  | "not_provisioned"
  /** A site is assigned but its credentials or URL are missing or unusable. */
  | "misconfigured"
  /** Reached the site, but it rejected our credentials. */
  | "unauthenticated"
  /** Reached and authenticated, but the version falls outside the supported range. */
  | "unsupported"
  /** Could not reach it, or it failed. Transient until proven otherwise. */
  | "unavailable"
  /** Reached, authenticated, version acceptable. */
  | "connected";

export interface ErpHealth {
  state: ErpHealthState;
  /** Present once a site is assigned; absent when not provisioned. */
  siteId?: string;
  /** A short sanitized sentence. Never a payload, a header or a credential. */
  detail?: string;
}

/**
 * The read-only path a Frappe site exposes for liveness. The only Frappe-specific string in this
 * module, and it lives here rather than in any caller — that is the boundary working.
 */
const PING_PATH = "/api/method/frappe.ping";

export async function checkErpHealth(params: {
  tenantId: string;
  client: ErpClient;
  correlationId: string;
}): Promise<ErpHealth> {
  const resolved = await resolveErpEnvironment(params.tenantId);

  if (resolved.status === "not_found") {
    return { state: "misconfigured", detail: "No such tenant." };
  }
  if (resolved.status === "not_provisioned") {
    // The honest state for every tenant today: reserved columns, no site. No screen may describe
    // this as connected, degraded, or pending sync.
    return { state: "not_provisioned", detail: "No ERP site has been provisioned yet." };
  }

  const environment = resolved.environment;

  try {
    await params.client.call(
      environment,
      { tenantId: params.tenantId, correlationId: params.correlationId },
      { method: "GET", path: PING_PATH },
    );
    return { state: "connected", siteId: environment.siteId };
  } catch (err) {
    if (!(err instanceof ErpError)) {
      return { state: "unavailable", siteId: environment.siteId, detail: "ERP check failed." };
    }

    return {
      state: healthStateFor(err),
      siteId: environment.siteId,
      // `ErpError.message` is already sanitized by the client; nothing further is added here.
      detail: err.message,
    };
  }
}

function healthStateFor(err: ErpError): ErpHealthState {
  switch (err.kind) {
    case "authentication_failed":
    case "authorization_failed":
      return "unauthenticated";
    case "unsupported_version":
      return "unsupported";
    case "configuration_error":
      return "misconfigured";
    case "not_provisioned":
      return "not_provisioned";
    default:
      // Everything else — timeout, 5xx, rate limit, garbled reply — is "we could not get an
      // answer". Distinguishing further would be guessing.
      return "unavailable";
  }
}
