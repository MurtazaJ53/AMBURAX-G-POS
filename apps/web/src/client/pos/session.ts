import { presentError, type PresentedError } from "@/client/platform/errorCatalog";
import type { ApiResult } from "@/client/platform/apiClient";
import type { PosSession } from "@/client/pos/types";

/**
 * The shift, as the screen understands it.
 *
 * ## Why a state machine and not a boolean
 *
 * "Is a shift open" is four different questions at a counter: is one open, is it *mine*, is it
 * on *this* terminal, and is the terminal even usable. A boolean answers the first and silently
 * guesses the rest, which is how a cashier ends up ringing sales into a colleague's shift.
 *
 * ## What is deliberately not here
 *
 * No opening float, no drawer count, no variance, no reconciliation. The backend does not model
 * cash balancing and says so in `posSessionService.ts`; a closing note is free text about a
 * handover, not a money figure. Putting a cash field on this screen would invite operators to
 * trust a number nobody computes.
 *
 * ## Resume is not a new shift
 *
 * The API answers 201 for a new shift and 200 with `resumed: true` for the caller's own shift
 * already open on that till — a reloaded browser is the same shift, and the screen says so
 * rather than implying a second one started.
 */

export type SessionState =
  /** Before the first read. Distinct from "no shift", which is a known fact. */
  | { phase: "unknown" }
  | { phase: "no_session" }
  | { phase: "opening" }
  | { phase: "active"; session: PosSession; resumed: boolean }
  /** A shift belonging to someone else is open on this terminal. */
  | { phase: "conflict"; session: PosSession | null; error: PresentedError }
  | { phase: "closing"; session: PosSession }
  | { phase: "closed"; session: PosSession }
  /** The terminal is unpaired, disabled, or the read itself failed. */
  | { phase: "unavailable"; error: PresentedError };

export type SessionAction =
  | { type: "load_answered"; result: ApiResult<{ session: PosSession | null }>; currentUserId: string }
  | { type: "open" }
  | { type: "open_answered"; result: ApiResult<{ session: PosSession; resumed?: boolean }>; status: number }
  | { type: "close" }
  | { type: "close_answered"; result: ApiResult<{ session: PosSession }> }
  /** Back to a workable state after the operator acknowledges a refusal. */
  | { type: "dismiss" };

export const initialSessionState: SessionState = { phase: "unknown" };

const OTHER_CASHIER: PresentedError = {
  title: "Shift already open",
  detail: "Another cashier has a shift open on this terminal.",
  recovery: "They must close their shift before a new one can start here.",
  severity: "blocking",
  correlationId: null,
};

/** True when a sale may be rung up — the only phase in which the till is really open. */
export function isSellable(state: SessionState): boolean {
  return state.phase === "active";
}

export function activeSession(state: SessionState): PosSession | null {
  return state.phase === "active" ? state.session : null;
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "load_answered": {
      if (!action.result.ok) return { phase: "unavailable", error: presentError(action.result) };

      const session = action.result.data.session;
      if (!session || !session.isOpen) return { phase: "no_session" };

      // Whose shift it is decides everything after this. The server will refuse a sale into
      // someone else's shift regardless; showing it here is what stops the cashier finding out
      // with a customer waiting.
      if (session.cashierUserId !== action.currentUserId) {
        return { phase: "conflict", session, error: OTHER_CASHIER };
      }
      return { phase: "active", session, resumed: true };
    }

    case "open":
      if (state.phase === "opening" || state.phase === "active") return state;
      return { phase: "opening" };

    case "open_answered": {
      if (action.result.ok) {
        // 201 is a new shift; 200 with `resumed` is the caller's own shift picked back up.
        const resumed = action.result.data.resumed === true || action.status === 200;
        return { phase: "active", session: action.result.data.session, resumed };
      }
      if (action.result.kind === "api" && action.result.code === "conflict") {
        return { phase: "conflict", session: null, error: presentError(action.result) };
      }
      return { phase: "unavailable", error: presentError(action.result) };
    }

    case "close": {
      const session = activeSession(state);
      if (!session) return state;
      return { phase: "closing", session };
    }

    case "close_answered": {
      if (action.result.ok) return { phase: "closed", session: action.result.data.session };
      if (state.phase === "closing") {
        // A close that was refused leaves the shift exactly as it was — open, and the
        // cashier's. Reporting it as closed would be the more dangerous lie.
        return { phase: "active", session: state.session, resumed: true };
      }
      return { phase: "unavailable", error: presentError(action.result) };
    }

    case "dismiss":
      if (state.phase === "conflict" || state.phase === "unavailable" || state.phase === "closed") {
        return { phase: "no_session" };
      }
      return state;
  }
}
