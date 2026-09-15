import { isIndeterminate, type ApiResult } from "@/client/platform/apiClient";
import { presentError, type PresentedError } from "@/client/platform/errorCatalog";
import type { CompletedSale } from "@/client/pos/types";

/**
 * Completing a sale: the one command on this screen that moves money.
 *
 * ## The failure that matters
 *
 * Not "the server said no" — that one is easy, and the error catalogue handles it. The one that
 * matters is "the server did not answer". A cashier told *"the sale failed"* after a timeout
 * will ring the same basket up again, and if the first attempt actually succeeded the customer
 * is charged twice. So an unanswered request never becomes a failure here. It becomes
 * `unresolved`, and the machine resolves it before saying anything to the operator.
 *
 * ## How it resolves
 *
 * By repeating the identical request, with the identical idempotency key. That is safe, and
 * it is safe because of a specific backend guarantee rather than optimism:
 * `@@unique([tenantId, idempotencyKey])` plus a replay read means the same key always yields
 * the same sale. So the retry either
 *
 *   - returns the sale that already happened (200, `duplicate: true`), or
 *   - performs the sale that had not happened (201, `duplicate: false`)
 *
 * and in both cases exactly one sale exists afterwards. There is no separate "look up what
 * happened" endpoint needed, and none is invented: the retry *is* the reconciliation.
 *
 * Note what is deliberately not assumed. The contract does not promise a 409 when the same key
 * arrives with a different payload — it promises the original result — so nothing here treats
 * a conflict as a signal, and nothing mutates the bill between attempts. The key is tied to
 * the bill, so a changed bill is a different key by construction.
 *
 * ## Double submission
 *
 * A second submit while one is in flight is dropped by the machine, not by a disabled button.
 * A disabled button is a courtesy; the state check is the guarantee, and it also covers the
 * Enter key, the barcode scanner's trailing newline and an impatient double tap.
 */

export const MAX_RECONCILE_ATTEMPTS = 3;

export type CompletionState =
  | { phase: "idle" }
  /** In flight. `attempt` is 1 for the first try. */
  | { phase: "submitting"; attempt: number }
  /** Unanswered. The outcome is unknown and is never reported as a failure. */
  | { phase: "unresolved"; attempt: number; error: PresentedError }
  /** Repeating the identical request to find out what happened. */
  | { phase: "reconciling"; attempt: number }
  /** `duplicate` is true when this attempt replayed a sale that had already completed. */
  | { phase: "completed"; sale: CompletedSale; duplicate: boolean }
  /** The server decided, and the decision was no. The outcome is known. */
  | { phase: "refused"; error: PresentedError }
  /**
   * Repeated attempts all went unanswered. Still not a failure — the sale may exist. The
   * operator is told to check the sale history rather than to ring it up again.
   */
  | { phase: "undetermined"; error: PresentedError };

export type CompletionAction =
  | { type: "submit" }
  | { type: "answered"; result: ApiResult<{ sale: CompletedSale; duplicate: boolean }> }
  | { type: "reconcile" }
  | { type: "reset" };

export const initialCompletionState: CompletionState = { phase: "idle" };

/** True while a request is in flight — the guard against a second submission. */
export function isInFlight(state: CompletionState): boolean {
  return state.phase === "submitting" || state.phase === "reconciling";
}

/** True when the operator may press "take payment". */
export function canSubmit(state: CompletionState): boolean {
  return state.phase === "idle" || state.phase === "refused";
}

const UNDETERMINED: PresentedError = {
  title: "Sale not confirmed",
  detail:
    "The server never answered, so the till cannot tell whether this sale went through. It may have.",
  recovery: "Check today's sales for this bill before ringing it up again.",
  severity: "indeterminate",
  correlationId: null,
};

export function completionReducer(
  state: CompletionState,
  action: CompletionAction,
): CompletionState {
  switch (action.type) {
    case "submit":
      // Dropped, not queued. A submission already in flight will answer for this bill.
      if (!canSubmit(state)) return state;
      return { phase: "submitting", attempt: 1 };

    case "reconcile":
      if (state.phase !== "unresolved") return state;
      if (state.attempt >= MAX_RECONCILE_ATTEMPTS) {
        return { phase: "undetermined", error: UNDETERMINED };
      }
      return { phase: "reconciling", attempt: state.attempt + 1 };

    case "answered": {
      // Narrowed explicitly rather than through `isInFlight`: the branch below needs
      // `attempt`, and a type guard that only returns a boolean cannot give it that.
      if (state.phase !== "submitting" && state.phase !== "reconciling") return state;
      const result = action.result;

      if (result.ok) {
        return {
          phase: "completed",
          sale: result.data.sale,
          duplicate: result.data.duplicate === true,
        };
      }

      // Unanswered: park in `unresolved` so the driver retries the identical request.
      if (isIndeterminate(result)) {
        if (state.attempt >= MAX_RECONCILE_ATTEMPTS) {
          return { phase: "undetermined", error: UNDETERMINED };
        }
        return { phase: "unresolved", attempt: state.attempt, error: presentError(result) };
      }

      // The server decided, and an answer — even a 503 — is a decision. The sale route's 503
      // is emitted only after the transaction rolled back, and says "Nothing was charged",
      // so it is a genuine refusal rather than an unknown. Only a request that never landed
      // is unknown, and that is the branch above.
      return { phase: "refused", error: presentError(result) };
    }

    case "reset":
      // A sale in flight is not abandoned by clearing the screen; the answer still matters.
      if (isInFlight(state)) return state;
      return { phase: "idle" };
  }
}

/** Backoff between reconciliation attempts. Short — a customer is standing there. */
export function reconcileDelayMs(attempt: number): number {
  return Math.min(400 * 2 ** (attempt - 1), 3_000);
}
