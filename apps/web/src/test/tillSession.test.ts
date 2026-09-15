import { describe, it, expect } from "vitest";
import {
  activeSession,
  initialSessionState,
  isSellable,
  sessionReducer,
  type SessionState,
} from "@/client/pos/session";
import type { ApiResult } from "@/client/platform/apiClient";
import type { PosSession } from "@/client/pos/types";

const ME = "user-me";
const THEM = "user-them";

function session(overrides: Partial<PosSession> = {}): PosSession {
  return {
    id: "sess-1",
    storeId: "store-1",
    posDeviceId: "dev-1",
    cashierUserId: ME,
    openedAt: "2026-09-15T09:00:00.000Z",
    closedAt: null,
    closingNote: null,
    isOpen: true,
    ...overrides,
  };
}

const loaded = (
  result: ApiResult<{ session: PosSession | null }>,
  currentUserId = ME,
) => ({ type: "load_answered" as const, result, currentUserId });

const okLoad = (value: PosSession | null): ApiResult<{ session: PosSession | null }> => ({
  ok: true,
  status: 200,
  data: { session: value },
  correlationId: "c",
});

describe("reading the shift on a terminal", () => {
  it("starts unknown, which is not the same as no shift", () => {
    expect(initialSessionState.phase).toBe("unknown");
    expect(isSellable(initialSessionState)).toBe(false);
  });

  it("reports no shift when the terminal has none", () => {
    const state = sessionReducer(initialSessionState, loaded(okLoad(null)));
    expect(state.phase).toBe("no_session");
  });

  it("treats a closed shift as no shift", () => {
    const state = sessionReducer(
      initialSessionState,
      loaded(okLoad(session({ isOpen: false, closedAt: "2026-09-15T17:00:00.000Z" }))),
    );
    expect(state.phase).toBe("no_session");
  });

  it("activates when the open shift is the caller's own", () => {
    const state = sessionReducer(initialSessionState, loaded(okLoad(session())));
    expect(state.phase).toBe("active");
    expect(isSellable(state)).toBe(true);
    expect(activeSession(state)?.id).toBe("sess-1");
  });

  it("refuses to sell into another cashier's shift", () => {
    const state = sessionReducer(
      initialSessionState,
      loaded(okLoad(session({ cashierUserId: THEM }))),
    );
    // The server would refuse the sale anyway; showing it here is what stops the cashier
    // finding out with a customer waiting.
    expect(state.phase).toBe("conflict");
    expect(isSellable(state)).toBe(false);
  });

  it("reports an unusable terminal rather than pretending there is no shift", () => {
    const state = sessionReducer(
      initialSessionState,
      loaded({
        ok: false,
        kind: "api",
        status: 409,
        code: "device_unavailable",
        message: "This terminal has been disabled.",
        correlationId: "c",
      }),
    );
    expect(state.phase).toBe("unavailable");
  });
});

describe("opening a shift", () => {
  it("shows an opening state while the request is in flight", () => {
    const state = sessionReducer({ phase: "no_session" }, { type: "open" });
    expect(state.phase).toBe("opening");
  });

  it("treats a 201 as a new shift", () => {
    const state = sessionReducer(
      { phase: "opening" },
      {
        type: "open_answered",
        status: 201,
        result: { ok: true, status: 201, data: { session: session() }, correlationId: "c" },
      },
    );
    expect(state.phase).toBe("active");
    if (state.phase === "active") expect(state.resumed).toBe(false);
  });

  it("treats a 200 with resumed as the same shift picked back up", () => {
    const state = sessionReducer(
      { phase: "opening" },
      {
        type: "open_answered",
        status: 200,
        result: {
          ok: true,
          status: 200,
          data: { session: session(), resumed: true },
          correlationId: "c",
        },
      },
    );
    expect(state.phase).toBe("active");
    // A reloaded browser is not a second shift, and the screen must not imply one started.
    if (state.phase === "active") expect(state.resumed).toBe(true);
  });

  it("reports a busy terminal as a conflict, not as a permission failure", () => {
    const state = sessionReducer(
      { phase: "opening" },
      {
        type: "open_answered",
        status: 0,
        result: {
          ok: false,
          kind: "api",
          status: 409,
          code: "conflict",
          message: "Another shift is open on this terminal.",
          correlationId: "c",
        },
      },
    );
    expect(state.phase).toBe("conflict");
  });

  it("reports a disabled capability as unavailable without naming the module", () => {
    const state = sessionReducer(
      { phase: "opening" },
      {
        type: "open_answered",
        status: 0,
        result: {
          ok: false,
          kind: "api",
          status: 404,
          code: "not_found",
          message: "Not found.",
          correlationId: "c",
        },
      },
    );
    expect(state.phase).toBe("unavailable");
    if (state.phase === "unavailable") {
      // The API deliberately does not say which capability is off, and neither may the UI.
      expect(state.error.detail.toLowerCase()).not.toContain("retail");
      expect(state.error.detail.toLowerCase()).not.toContain("capability");
    }
  });
});

describe("closing a shift", () => {
  const active: SessionState = { phase: "active", session: session(), resumed: false };

  it("shows a closing state", () => {
    expect(sessionReducer(active, { type: "close" }).phase).toBe("closing");
  });

  it("reports the shift closed when the server confirms", () => {
    const closing = sessionReducer(active, { type: "close" });
    const state = sessionReducer(closing, {
      type: "close_answered",
      result: {
        ok: true,
        status: 200,
        data: { session: session({ isOpen: false, closedAt: "2026-09-15T17:00:00.000Z" }) },
        correlationId: "c",
      },
    });
    expect(state.phase).toBe("closed");
    expect(isSellable(state)).toBe(false);
  });

  it("leaves the shift open when the close was refused", () => {
    const closing = sessionReducer(active, { type: "close" });
    const state = sessionReducer(closing, {
      type: "close_answered",
      result: {
        ok: false,
        kind: "api",
        status: 409,
        code: "conflict",
        message: "This shift is already closed.",
        correlationId: "c",
      },
    });
    // Reporting a refused close as closed is the more dangerous lie: the cashier would walk
    // away from a till that is still theirs and still open.
    expect(state.phase).toBe("active");
  });
});
