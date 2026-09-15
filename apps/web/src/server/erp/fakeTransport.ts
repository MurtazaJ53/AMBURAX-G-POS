import type { ErpCredentials } from "@/server/erp/config";
import type { ErpRequest, ErpResponse, ErpTransport } from "@/server/erp/transport";
import { ErpTransportError } from "@/server/erp/transport";

/**
 * A scripted transport for tests.
 *
 * **Test support. No production code imports this, and nothing here talks to a network.** It
 * exists so the whole failure surface of the boundary — 401, 403, 404, 409, 422, 429, 5xx,
 * timeout, connection loss, garbled body — can be exercised deterministically without an ERPNext
 * instance being installed, vendored or reached. That constraint is deliberate: a test suite
 * that needs somebody's ERP server running is a test suite that gets skipped.
 *
 * It also records what it was asked to send, which is how the correlation-id and
 * idempotency-key propagation tests check that those actually leave the adapter rather than
 * being quietly dropped.
 */

export type ScriptedOutcome =
  | { kind: "respond"; status: number; body: unknown }
  | { kind: "timeout" }
  | { kind: "connection" }
  | { kind: "malformed" };

export class FakeErpTransport implements ErpTransport {
  /** Every request the adapter handed over, in order. Inspected by tests. */
  readonly sent: ErpRequest[] = [];
  /** Credentials as seen by the transport, so a test can prove they never reach a log. */
  readonly credentialsSeen: ErpCredentials[] = [];

  private queue: ScriptedOutcome[] = [];
  private fallback: ScriptedOutcome = { kind: "respond", status: 200, body: { message: "ok" } };

  /** Queue one outcome per call, consumed in order. */
  script(...outcomes: ScriptedOutcome[]): this {
    this.queue.push(...outcomes);
    return this;
  }

  /** What to return once the queue is empty. Defaults to a bland 200. */
  always(outcome: ScriptedOutcome): this {
    this.fallback = outcome;
    return this;
  }

  async send(request: ErpRequest, credentials: ErpCredentials): Promise<ErpResponse> {
    this.sent.push(request);
    this.credentialsSeen.push(credentials);

    const outcome = this.queue.shift() ?? this.fallback;

    switch (outcome.kind) {
      case "respond":
        return { status: outcome.status, body: outcome.body };
      case "timeout":
        throw new ErpTransportError("timeout", `Request timed out after ${request.timeoutMs}ms`);
      case "connection":
        throw new ErpTransportError("connection", "Connection reset");
      case "malformed":
        // A body that is not the shape any ERPNext reply takes. The adapter has to notice rather
        // than pass the debris upward.
        return { status: 200, body: "<html>502 Bad Gateway</html>" };
    }
  }
}
