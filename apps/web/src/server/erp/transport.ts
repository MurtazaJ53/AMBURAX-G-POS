import type { ErpCredentials } from "@/server/erp/config";

/**
 * The narrowest possible description of "talk to an ERPNext site".
 *
 * An interface, so the adapter can be tested exhaustively without an ERPNext server anywhere in
 * sight. No ERPNext instance is installed, vendored, cloned or contacted by this repository's
 * test suite; every behaviour below — auth failure, rate limiting, timeout, malformed reply — is
 * reproduced by the fake in `fakeTransport.ts`.
 *
 * Nothing above this interface knows about HTTP. Nothing below it knows about AMBURAX domain
 * types. That is the whole boundary, in one type.
 */

export interface ErpRequest {
  /** HTTP-ish verb. The transport decides what that means on the wire. */
  method: "GET" | "POST" | "PUT" | "DELETE";
  /**
   * Path relative to the site, e.g. `/api/method/frappe.ping`. This is the one place a Frappe
   * path is allowed to appear, and only a transport or an adapter port may construct one.
   */
  path: string;
  body?: unknown;
  /**
   * Carried to the ERP so a request can be traced across both systems, and echoed into our own
   * logs. Never a secret.
   */
  correlationId: string;
  /** Present on mutating calls. Derived from an AMBURAX fact, never randomly generated. */
  idempotencyKey?: string;
  /** Milliseconds. The transport must treat exceeding this as a timeout, not as a failure. */
  timeoutMs: number;
}

export interface ErpResponse {
  status: number;
  body: unknown;
}

export interface ErpTransport {
  send(request: ErpRequest, credentials: ErpCredentials): Promise<ErpResponse>;
}

/**
 * A transport-level failure that never reached, or never returned from, the ERP.
 *
 * Distinct from an HTTP status, because the two need opposite treatment: a 4xx is an answer, and
 * a timeout is the absence of one. Only the second is ambiguous about whether the work happened.
 */
export class ErpTransportError extends Error {
  readonly reason: "timeout" | "connection" | "malformed";

  constructor(reason: "timeout" | "connection" | "malformed", message: string) {
    super(message);
    this.name = "ErpTransportError";
    this.reason = reason;
  }
}
