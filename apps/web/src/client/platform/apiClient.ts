/**
 * The browser's one way of talking to the v1 API.
 *
 * Everything on the till goes through this, for a reason that only shows up at a counter: a
 * failed request and an *unanswered* request are not the same event. A 409 means the server
 * decided something. A timeout means nobody knows yet. Code that collapses the two will
 * eventually tell a cashier a sale failed when the money has already moved, so the result type
 * here keeps them apart and forces every caller to say which it is handling.
 *
 * The envelope it parses is the one every v1 route returns:
 *   success  { status: "ok", ...payload, correlationId }
 *   failure  { error: { code, message }, correlationId }
 *
 * Credentials ride on the session cookie, which is HttpOnly and never readable here. Nothing in
 * this file sends, stores or derives a tenant id — the server reads it from the session, and a
 * client that supplied one would be ignored.
 */

export type ApiResult<T> =
  | { ok: true; status: number; data: T; correlationId: string | null }
  /** The server answered, and the answer was a refusal. The outcome is known. */
  | { ok: false; kind: "api"; status: number; code: string; message: string; correlationId: string | null }
  /** The request never completed. The outcome is unknown — it may well have succeeded. */
  | { ok: false; kind: "timeout" }
  | { ok: false; kind: "network" }
  /** A 2xx whose body was not the envelope. Treated as unknown, not as success. */
  | { ok: false; kind: "malformed"; status: number };

/** Outcomes where the server's decision is genuinely unknown to us. */
export function isIndeterminate<T>(result: ApiResult<T>): boolean {
  return !result.ok && (result.kind === "timeout" || result.kind === "network" || result.kind === "malformed");
}

export interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  /** Caller-owned abort — used to drop a stale search, not to cancel a sale. */
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Long enough that a slow counter connection is not mistaken for a dead one. */
export const DEFAULT_TIMEOUT_MS = 15_000;

function newCorrelationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `cid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onCallerAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onCallerAbort);

  try {
    const response = await fetch(path, {
      method: options.method ?? "GET",
      headers: {
        Accept: "application/json",
        "x-correlation-id": newCorrelationId(),
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      // The session cookie is same-origin; nothing here is a cross-site call.
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const envelope = payload as { error?: { code?: string; message?: string }; correlationId?: string } | null;
      const code = envelope?.error?.code;
      const message = envelope?.error?.message;
      if (typeof code === "string" && typeof message === "string") {
        return {
          ok: false,
          kind: "api",
          status: response.status,
          code,
          message,
          correlationId: envelope?.correlationId ?? null,
        };
      }
      // A non-2xx that is not our envelope is not something to paraphrase to a cashier.
      // It gets a synthetic code and the catalogue speaks for it.
      return {
        ok: false,
        kind: "api",
        status: response.status,
        code: "unexpected_response",
        message: "",
        correlationId: null,
      };
    }

    if (payload === null || typeof payload !== "object") {
      return { ok: false, kind: "malformed", status: response.status };
    }

    const envelope = payload as { status?: string; correlationId?: string };
    if (envelope.status !== "ok") {
      return { ok: false, kind: "malformed", status: response.status };
    }

    return {
      ok: true,
      status: response.status,
      data: payload as T,
      correlationId: envelope.correlationId ?? null,
    };
  } catch {
    // AbortError from our own timer, AbortError from the caller, and a genuine transport
    // failure all land here; only the first is reliably distinguishable, and the caller's
    // own abort is its own business.
    if (timedOut) return { ok: false, kind: "timeout" };
    if (options.signal?.aborted) return { ok: false, kind: "network" };
    return { ok: false, kind: "network" };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onCallerAbort);
  }
}
