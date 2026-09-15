/**
 * The ERP boundary's error model. Pure types and classification — no transport, no I/O.
 *
 * ## Why translate at all
 *
 * ERPNext is a large external system on its own release cadence. Without a boundary its error
 * shapes become our domain's error shapes, and an ERPNext upgrade turns into a cross-codebase
 * refactor. Domain code therefore never sees an HTTP status, a Frappe exception name, a
 * traceback or a doctype — it sees one of the categories below.
 *
 * ## Two levels, deliberately
 *
 * `ErpErrorKind` is the fine-grained classification the adapter itself needs in order to decide
 * whether a call may be retried and what to put in a log line. `ErpErrorCategory` is the closed
 * set frozen in docs/architecture/ERP_ADAPTER.md that domain callers match on. Every kind maps
 * to exactly one category, so the domain's surface stays the five names the architecture froze
 * while the adapter keeps the detail it needs.
 *
 * ## The rule that matters most
 *
 * **A timeout is never a success.** An ambiguous outcome resolves to `ErpUnavailable` plus a
 * reconciliation obligation, never to "probably posted". DISASTER_RECOVERY.md states this as a
 * product rule; here it is structural.
 */

/** The closed set domain code matches on. Frozen in ERP_ADAPTER.md; do not extend casually. */
export type ErpErrorCategory =
  /** Transport, timeout or 5xx. Retry later; never treat as success. */
  | "ErpUnavailable"
  /** ERP validated the request and refused it. Surface it; do not retry unchanged. */
  | "ErpRejected"
  /** Duplicate or state conflict. Reconcile using the idempotency key. */
  | "ErpConflict"
  /** The tenant has no site or company yet. A provisioning gap, not a user error. */
  | "ErpNotProvisioned"
  /** The site's version falls outside the supported range. Operational escalation. */
  | "ErpVersionUnsupported";

/**
 * What actually went wrong, as precisely as the adapter can tell. Used for retry classification
 * and for logs; never pattern-matched by domain code.
 */
export type ErpErrorKind =
  | "authentication_failed"
  | "authorization_failed"
  | "not_found"
  | "validation_failed"
  | "conflict"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "server_error"
  | "unsupported_version"
  | "malformed_response"
  | "not_provisioned"
  | "configuration_error";

/**
 * Kind to category. Written as a total map rather than a switch, so adding a kind without
 * deciding its category is a compile error rather than a silent fall-through.
 *
 * Note where authentication and authorization land: `ErpRejected`, not `ErpUnavailable`. Bad
 * credentials will not fix themselves, and retrying them wastes the ERP's rate budget while
 * hiding the real problem. Configuration errors are the same — a missing site id is a defect,
 * not weather.
 */
const CATEGORY_OF: Readonly<Record<ErpErrorKind, ErpErrorCategory>> = {
  authentication_failed: "ErpRejected",
  authorization_failed: "ErpRejected",
  not_found: "ErpRejected",
  validation_failed: "ErpRejected",
  conflict: "ErpConflict",
  rate_limited: "ErpUnavailable",
  timeout: "ErpUnavailable",
  unavailable: "ErpUnavailable",
  server_error: "ErpUnavailable",
  unsupported_version: "ErpVersionUnsupported",
  malformed_response: "ErpUnavailable",
  not_provisioned: "ErpNotProvisioned",
  configuration_error: "ErpRejected",
};

/**
 * Whether the adapter considers a kind safe to try again.
 *
 * "Safe to try again" is not "will succeed" — it means the failure carries no information that a
 * second identical attempt would violate. Retries themselves live in the outbox dispatcher and
 * in the adapter, never scattered through domain code; this function only classifies.
 *
 * `malformed_response` is retryable because a garbled response usually means a truncated or
 * proxied connection rather than a rejected request — and, crucially, because the call may have
 * succeeded on the ERP side. That ambiguity is exactly what the idempotency key exists to
 * resolve.
 */
const RETRYABLE: Readonly<Record<ErpErrorKind, boolean>> = {
  authentication_failed: false,
  authorization_failed: false,
  not_found: false,
  validation_failed: false,
  conflict: false,
  rate_limited: true,
  timeout: true,
  unavailable: true,
  server_error: true,
  unsupported_version: false,
  malformed_response: true,
  not_provisioned: false,
  configuration_error: false,
};

export function categoryOf(kind: ErpErrorKind): ErpErrorCategory {
  return CATEGORY_OF[kind];
}

export function isRetryable(kind: ErpErrorKind): boolean {
  return RETRYABLE[kind];
}

/**
 * The only error type that crosses the boundary outward.
 *
 * Carries no ERPNext payload, no headers, no credentials and no traceback. `message` is a short
 * sanitized sentence — `client.ts` passes every upstream string through `sanitizeText` before it
 * reaches this constructor.
 */
export class ErpError extends Error {
  readonly kind: ErpErrorKind;
  readonly category: ErpErrorCategory;
  readonly retryable: boolean;
  /** Ties the failure back to the request that caused it, for logs and for reconciliation. */
  readonly correlationId: string | undefined;
  /** True when the call may have taken effect on the ERP side despite failing here. */
  readonly ambiguous: boolean;

  constructor(params: {
    kind: ErpErrorKind;
    message: string;
    correlationId?: string;
    ambiguous?: boolean;
  }) {
    super(params.message);
    this.name = "ErpError";
    this.kind = params.kind;
    this.category = categoryOf(params.kind);
    this.retryable = isRetryable(params.kind);
    this.correlationId = params.correlationId;
    // A timeout or a garbled reply may have been applied on the far side. Anything else either
    // never arrived or was explicitly refused.
    this.ambiguous =
      params.ambiguous ?? (params.kind === "timeout" || params.kind === "malformed_response");
  }
}

/**
 * Map an HTTP status to a kind.
 *
 * Deliberately conservative: an unrecognised 4xx is `validation_failed` (refused, do not retry)
 * and an unrecognised 5xx is `server_error` (retry). Guessing the other way round would either
 * hammer an ERP that has already said no, or silently drop work that would have succeeded.
 */
export function kindFromHttpStatus(status: number): ErpErrorKind {
  if (status === 401) return "authentication_failed";
  if (status === 403) return "authorization_failed";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 417 || status === 422) return "validation_failed";
  if (status === 429) return "rate_limited";
  if (status === 502 || status === 503 || status === 504) return "unavailable";
  if (status >= 500) return "server_error";
  if (status >= 400) return "validation_failed";
  return "server_error";
}
