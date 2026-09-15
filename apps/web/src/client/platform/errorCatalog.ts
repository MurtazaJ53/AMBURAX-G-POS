import type { ApiResult } from "@/client/platform/apiClient";

/**
 * What the person at the counter is told when something refuses.
 *
 * Two rules shape this file. First, a cashier is never shown a raw server string they cannot
 * act on — every message here says what happened *and* what to do next, in counter language.
 * Second, the mapping is keyed on the API's `code`, never on its `message`: codes are the
 * stable half of the envelope and messages are explicitly allowed to be reworded upstream, so
 * branching on prose would break silently the first time someone improved a sentence.
 *
 * An unrecognised code falls back to a generic failure carrying the correlation id — which is
 * the one piece of internal detail that genuinely helps, because it is what support will ask
 * for. It leaks nothing: it identifies a log line, not a tenant, a table or a query.
 */

export type ErrorSeverity =
  /** The cashier can fix it at the counter and carry on. */
  | "recoverable"
  /** The bill cannot proceed as it stands; something must change first. */
  | "blocking"
  /** Nobody knows whether the server acted. Never presented as a failure. */
  | "indeterminate";

export interface PresentedError {
  title: string;
  detail: string;
  /** The next physical action. Empty when there genuinely isn't one. */
  recovery: string;
  severity: ErrorSeverity;
  /** Shown small, for support. Null when we have none. */
  correlationId: string | null;
}

interface CatalogEntry {
  title: string;
  detail: string;
  recovery: string;
  severity: ErrorSeverity;
}

const CATALOG: Record<string, CatalogEntry> = {
  unauthorized: {
    title: "Signed out",
    detail: "This session has expired.",
    recovery: "Sign in again to carry on. Nothing on this bill has been charged.",
    severity: "blocking",
  },
  forbidden: {
    title: "Not permitted",
    detail: "Your role in this store does not allow this.",
    recovery: "Ask an owner or store manager to change your access.",
    severity: "blocking",
  },
  no_store: {
    title: "No store set up",
    detail: "This business has not finished setting up a store.",
    recovery: "Finish setup before using the till.",
    severity: "blocking",
  },
  // The API returns a plain not-found for a disabled capability on purpose, so this one
  // message has to serve both "route does not exist" and "module is switched off". It says
  // neither, and points at the person who can find out.
  not_found: {
    title: "Not available",
    detail: "This is not available on this account.",
    recovery: "Ask an owner to check the store's setup.",
    severity: "blocking",
  },
  validation_error: {
    title: "Check that again",
    detail: "Something in the request was not accepted.",
    recovery: "Correct the highlighted field and retry.",
    severity: "recoverable",
  },
  invalid_request: {
    title: "Could not be sent",
    detail: "The till sent something the server could not read.",
    recovery: "Retry. If it happens again, reload the till.",
    severity: "recoverable",
  },

  // --- scanning and the bill -------------------------------------------------------
  empty_cart: {
    title: "Nothing to charge",
    detail: "There are no items on this bill.",
    recovery: "Scan at least one item before taking payment.",
    severity: "recoverable",
  },
  too_many_lines: {
    title: "Too many lines",
    detail: "This bill has more lines than one sale can hold.",
    recovery: "Split it across two bills.",
    severity: "blocking",
  },
  invalid_quantity: {
    title: "Quantity not accepted",
    detail: "One of the quantities is outside what a sale allows.",
    recovery: "Correct the quantity and try again.",
    severity: "recoverable",
  },
  unknown_variant: {
    title: "Item no longer available",
    detail: "One of the items on this bill is no longer in the catalogue.",
    recovery: "Remove that line and take payment again.",
    severity: "recoverable",
  },
  inactive_variant: {
    title: "Item not for sale",
    detail: "One of the items on this bill has been withdrawn from sale.",
    recovery: "Remove that line and take payment again.",
    severity: "recoverable",
  },
  unknown_customer: {
    title: "Customer not found",
    detail: "The attached customer could not be found.",
    recovery: "Clear the customer and take payment again.",
    severity: "recoverable",
  },

  // --- shifts ----------------------------------------------------------------------
  invalid_session: {
    title: "Shift not usable",
    detail: "This shift is closed, belongs to another cashier, or belongs to another store.",
    recovery: "Open a shift on this terminal and take payment again.",
    severity: "blocking",
  },
  conflict: {
    title: "Terminal busy",
    detail: "Another shift is already open on this terminal.",
    recovery: "That cashier must close their shift before a new one can start.",
    severity: "blocking",
  },
  device_unavailable: {
    title: "Terminal unavailable",
    detail: "This terminal is not paired, or has been disabled.",
    recovery: "Ask an owner or store manager to pair or re-enable it.",
    severity: "blocking",
  },

  // --- infrastructure --------------------------------------------------------------
  service_unavailable: {
    title: "Temporarily unavailable",
    detail: "The server could not complete this.",
    recovery: "Wait a moment and try again.",
    severity: "recoverable",
  },
  rate_limited: {
    title: "Too many attempts",
    detail: "Too many attempts in a short time.",
    recovery: "Wait a moment before trying again.",
    severity: "recoverable",
  },
};

const UNKNOWN: CatalogEntry = {
  title: "Something went wrong",
  detail: "The till could not complete that.",
  recovery: "Try again. If it keeps happening, quote the reference below to support.",
  severity: "recoverable",
};

const TIMEOUT: CatalogEntry = {
  title: "No answer yet",
  detail: "The server has not answered. It may still be working on it.",
  recovery: "Do not retype the bill — the till will check what happened.",
  severity: "indeterminate",
};

const NETWORK: CatalogEntry = {
  title: "Connection lost",
  detail: "The till could not reach the server.",
  recovery: "Check the connection. The till will check what happened before anything is repeated.",
  severity: "indeterminate",
};

/** Turn any failed `ApiResult` into something safe to put on a counter-facing screen. */
export function presentError<T>(result: ApiResult<T>): PresentedError {
  if (result.ok) {
    throw new Error("presentError called with a successful result");
  }

  if (result.kind === "timeout") return { ...TIMEOUT, correlationId: null };
  if (result.kind === "network") return { ...NETWORK, correlationId: null };
  if (result.kind === "malformed") {
    return {
      title: "Unexpected answer",
      detail: "The server answered in a form the till did not recognise.",
      recovery: "Nothing has been assumed. Reload the till and check the last sale before repeating it.",
      severity: "indeterminate",
      correlationId: null,
    };
  }

  const entry = CATALOG[result.code] ?? UNKNOWN;
  return { ...entry, correlationId: result.correlationId };
}
