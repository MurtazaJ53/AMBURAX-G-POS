import { sanitizeText } from "@/lib/safeLog";
import type { ErpCredentialProvider, ErpEnvironment } from "@/server/erp/config";
import { ErpError, kindFromHttpStatus } from "@/server/erp/errors";
import type { ErpRequest, ErpResponse, ErpTransport } from "@/server/erp/transport";
import { ErpTransportError } from "@/server/erp/transport";

/**
 * The one component that turns "talk to ERPNext" into an AMBURAX-shaped result.
 *
 * Everything ERPNext-specific stops here: HTTP statuses, Frappe response envelopes, timeouts,
 * version strings. Above this line the domain sees `ErpError` with one of five frozen categories
 * and nothing else.
 *
 * ## Version boundary
 *
 * No ERPNext version has been frozen for this product — `ERPNext_VERSION_PIN.md` does not exist
 * yet — so this phase does not invent one. `supportedVersions` is configuration with no default:
 * leave it empty and the client performs no version assertion, which is the honest behaviour
 * when nothing has been committed to. Supply a list and a site outside it is refused loudly with
 * `ErpVersionUnsupported`, never guessed at. Version-specific request translation is later work
 * and belongs behind this class, never in domain code.
 *
 * ## Retries
 *
 * This client does not retry. It classifies. `ErpError.retryable` tells the caller — in practice
 * the outbox dispatcher, which already implements bounded exponential backoff — whether another
 * attempt is sound. A retry loop hidden inside a client is how a struggling ERP turns into a
 * thundering herd, and how one user action becomes four invoices.
 *
 * ## Exactly-once is not claimed anywhere
 *
 * Delivery is at-least-once. The idempotency key is what makes that survivable: the same key
 * replays to the same ERP document, so a retried call and a reconciliation sweep agree on one
 * outcome. Where ERPNext cannot be made idempotent for an operation, a future port must record
 * intent before calling and resolve it after — the claim-check the frozen contract describes.
 */

export interface ErpCallContext {
  /** From authenticated server context. Never from a request body, query or header. */
  tenantId: string;
  correlationId: string;
  /** The event or command that caused this call, when there is one. */
  causationId?: string;
}

export interface ErpCallOptions {
  method: ErpRequest["method"];
  path: string;
  body?: unknown;
  /** Required for mutating calls; derived from an AMBURAX fact. */
  idempotencyKey?: string;
  timeoutMs?: number;
}

/** Safe to log: identifiers and outcomes, never payloads, headers or credentials. */
export interface ErpCallTelemetry {
  tenantId: string;
  siteId: string;
  correlationId: string;
  operation: string;
  durationMs: number;
  outcome: "ok" | "error";
  errorKind?: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class ErpClient {
  constructor(
    private readonly transport: ErpTransport,
    private readonly credentials: ErpCredentialProvider,
    private readonly options: {
      /** Empty means "no version has been pinned", and no assertion is performed. */
      supportedVersions?: readonly string[];
      /** Receives telemetry for every call. Never handed a payload or a credential. */
      onTelemetry?: (telemetry: ErpCallTelemetry) => void;
    } = {},
  ) {}

  /**
   * Perform one call against a tenant's site.
   *
   * The environment must already be resolved, which is what stops a caller naming someone else's
   * site: `resolveErpEnvironment` only ever returns the environment belonging to the tenantId it
   * was given, and that tenantId comes from the session.
   */
  async call(
    environment: ErpEnvironment,
    context: ErpCallContext,
    options: ErpCallOptions,
  ): Promise<ErpResponse> {
    if (environment.tenantId !== context.tenantId) {
      // Belt and braces against a future caller pairing a context with the wrong environment.
      throw new ErpError({
        kind: "configuration_error",
        message: "The ERP environment does not belong to the calling tenant.",
        correlationId: context.correlationId,
      });
    }

    this.assertVersionSupported(environment, context.correlationId);

    const startedAt = Date.now();
    try {
      const credentials = await this.credentials.credentialsFor(environment);
      const request: ErpRequest = {
        method: options.method,
        path: options.path,
        body: options.body,
        correlationId: context.correlationId,
        idempotencyKey: options.idempotencyKey,
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      };

      const response = await this.transport.send(request, credentials);

      if (response.status >= 400) {
        throw new ErpError({
          kind: kindFromHttpStatus(response.status),
          // Sanitized, and deliberately not the body: an ERP validation message can quote the
          // document it refused, and that document is somebody's commercial data.
          message: `ERP refused the request (status ${response.status}).`,
          correlationId: context.correlationId,
        });
      }

      if (!isPlausibleErpBody(response.body)) {
        throw new ErpError({
          kind: "malformed_response",
          message: "ERP returned a response that could not be understood.",
          correlationId: context.correlationId,
        });
      }

      this.report(environment, context, options, startedAt, "ok");
      return response;
    } catch (err) {
      const error = this.normalise(err, context.correlationId);
      this.report(environment, context, options, startedAt, "error", error.kind);
      throw error;
    }
  }

  /**
   * Turn anything thrown below into an `ErpError`.
   *
   * Every message passes through `sanitizeText`, the same redaction the rest of the system uses
   * for logs — so a connection string, bearer token or API key embedded in a driver's error
   * string cannot escape through the boundary.
   */
  private normalise(err: unknown, correlationId: string): ErpError {
    if (err instanceof ErpError) return err;

    if (err instanceof ErpTransportError) {
      const kind =
        err.reason === "timeout"
          ? "timeout"
          : err.reason === "malformed"
            ? "malformed_response"
            : "unavailable";
      return new ErpError({ kind, message: sanitizeText(err.message), correlationId });
    }

    // Anything else is unknown, and unknown means "we do not know whether it happened". That is
    // `unavailable` with ambiguity, never a rejection — treating it as a refusal would silently
    // drop work the ERP may have accepted.
    return new ErpError({
      kind: "unavailable",
      message: sanitizeText(err instanceof Error ? err.message : "ERP call failed."),
      correlationId,
      ambiguous: true,
    });
  }

  private assertVersionSupported(environment: ErpEnvironment, correlationId: string): void {
    const supported = this.options.supportedVersions ?? [];
    // No pin configured means no claim is made. Asserting against an invented version would be
    // worse than not asserting: it would look like a guarantee.
    if (supported.length === 0) return;
    if (!environment.version) return;

    if (!supported.includes(environment.version)) {
      throw new ErpError({
        kind: "unsupported_version",
        message: `ERP site version ${environment.version} is outside the supported range.`,
        correlationId,
      });
    }
  }

  private report(
    environment: ErpEnvironment,
    context: ErpCallContext,
    options: ErpCallOptions,
    startedAt: number,
    outcome: "ok" | "error",
    errorKind?: string,
  ): void {
    this.options.onTelemetry?.({
      tenantId: context.tenantId,
      siteId: environment.siteId,
      correlationId: context.correlationId,
      // The path, not the body. A path names an operation; a body contains a customer's data.
      operation: `${options.method} ${options.path}`,
      durationMs: Date.now() - startedAt,
      outcome,
      errorKind,
    });
  }
}

/**
 * A minimal sanity check on the shape of a reply.
 *
 * Frappe answers with a JSON object. A string, an array or a null is a proxy error page, a
 * truncated stream or a login redirect wearing a 200 — all of which must become
 * `malformed_response` rather than being handed to a caller that will read fields off them.
 */
function isPlausibleErpBody(body: unknown): boolean {
  return typeof body === "object" && body !== null && !Array.isArray(body);
}
