import { describe, it, expect } from "vitest";
import {
  completionReducer,
  initialCompletionState,
  canSubmit,
  isInFlight,
  MAX_RECONCILE_ATTEMPTS,
  reconcileDelayMs,
  type CompletionState,
} from "@/client/pos/completion";
import type { ApiResult } from "@/client/platform/apiClient";
import type { CompletedSale } from "@/client/pos/types";

/**
 * The completion machine is the only part of the till where being wrong costs a customer
 * money. These cases are written against that, not against the happy path.
 */

const sale: CompletedSale = {
  id: "sale-1",
  billNumber: "B-0001",
  totalMinor: 30000,
  subtotalMinor: 28572,
  taxMinor: 1428,
  discountMinor: 0,
  paidMinor: 30000,
  paymentStatus: "PAID",
  erpSyncStatus: "PENDING",
  completedAt: "2026-09-15T10:00:00.000Z",
};

type SaleResult = ApiResult<{ sale: CompletedSale; duplicate: boolean }>;

const answered = (result: SaleResult) => ({ type: "answered" as const, result });

function drive(state: CompletionState, actions: Parameters<typeof completionReducer>[1][]) {
  return actions.reduce(completionReducer, state);
}

describe("submitting", () => {
  it("moves to submitting on the first attempt", () => {
    const state = completionReducer(initialCompletionState, { type: "submit" });
    expect(state).toEqual({ phase: "submitting", attempt: 1 });
  });

  it("drops a second submission while one is in flight", () => {
    const first = completionReducer(initialCompletionState, { type: "submit" });
    const second = completionReducer(first, { type: "submit" });
    // Dropped by the machine, not by a disabled button: this also covers the Enter key and a
    // barcode scanner's trailing newline, which no button state can intercept.
    expect(second).toBe(first);
    expect(isInFlight(second)).toBe(true);
    expect(canSubmit(second)).toBe(false);
  });

  it("reports a completed sale", () => {
    const state = drive(initialCompletionState, [
      { type: "submit" },
      answered({ ok: true, status: 201, data: { sale, duplicate: false }, correlationId: "c" }),
    ]);
    expect(state).toEqual({ phase: "completed", sale, duplicate: false });
  });

  it("treats a replayed sale as a success, flagged as already recorded", () => {
    const state = drive(initialCompletionState, [
      { type: "submit" },
      answered({ ok: true, status: 200, data: { sale, duplicate: true }, correlationId: "c" }),
    ]);
    expect(state.phase).toBe("completed");
    if (state.phase === "completed") expect(state.duplicate).toBe(true);
  });
});

describe("a refusal the server actually made", () => {
  it("is reported as refused, with counter-facing wording", () => {
    const state = drive(initialCompletionState, [
      { type: "submit" },
      answered({
        ok: false,
        kind: "api",
        status: 409,
        code: "inactive_variant",
        message: "One of the items is no longer for sale. Remove it and try again.",
        correlationId: "cid-9",
      }),
    ]);
    expect(state.phase).toBe("refused");
    if (state.phase === "refused") {
      expect(state.error.severity).toBe("recoverable");
      expect(state.error.recovery).not.toBe("");
    }
  });

  it("treats the sale route's 503 as a decision, because it says nothing was charged", () => {
    const state = drive(initialCompletionState, [
      { type: "submit" },
      answered({
        ok: false,
        kind: "api",
        status: 503,
        code: "service_unavailable",
        message: "The sale could not be completed.",
        correlationId: "cid-10",
      }),
    ]);
    expect(state.phase).toBe("refused");
  });

  it("allows a fresh submission after a refusal", () => {
    const refused = drive(initialCompletionState, [
      { type: "submit" },
      answered({
        ok: false,
        kind: "api",
        status: 400,
        code: "empty_cart",
        message: "Add at least one item.",
        correlationId: "c",
      }),
    ]);
    expect(canSubmit(refused)).toBe(true);
  });
});

describe("an unanswered request", () => {
  it("is never reported as a failure", () => {
    const state = drive(initialCompletionState, [
      { type: "submit" },
      answered({ ok: false, kind: "timeout" }),
    ]);
    expect(state.phase).toBe("unresolved");
    if (state.phase === "unresolved") expect(state.error.severity).toBe("indeterminate");
  });

  it("retries the same attempt count forward, so the same key is replayed", () => {
    let state = drive(initialCompletionState, [
      { type: "submit" },
      answered({ ok: false, kind: "timeout" }),
    ]);
    state = completionReducer(state, { type: "reconcile" });
    expect(state).toEqual({ phase: "reconciling", attempt: 2 });
  });

  it("resolves to completed when the replay returns the original sale", () => {
    let state = drive(initialCompletionState, [
      { type: "submit" },
      answered({ ok: false, kind: "network" }),
      { type: "reconcile" },
    ]);
    // This is the whole safety argument: the same idempotency key returns the sale that
    // already happened, so a retry cannot charge twice.
    state = completionReducer(
      state,
      answered({ ok: true, status: 200, data: { sale, duplicate: true }, correlationId: "c" }),
    );
    expect(state).toEqual({ phase: "completed", sale, duplicate: true });
  });

  it("ends as undetermined, not failed, when every attempt goes unanswered", () => {
    let state: CompletionState = completionReducer(initialCompletionState, { type: "submit" });
    for (let i = 0; i < MAX_RECONCILE_ATTEMPTS + 2; i += 1) {
      state = completionReducer(state, answered({ ok: false, kind: "timeout" }));
      state = completionReducer(state, { type: "reconcile" });
    }
    expect(state.phase).toBe("undetermined");
    if (state.phase === "undetermined") {
      expect(state.error.severity).toBe("indeterminate");
      // The instruction must be to look, never to repeat.
      expect(state.error.recovery.toLowerCase()).toContain("check");
    }
  });

  it("treats a malformed 2xx as unknown rather than as success", () => {
    const state = drive(initialCompletionState, [
      { type: "submit" },
      answered({ ok: false, kind: "malformed", status: 200 }),
    ]);
    expect(state.phase).toBe("unresolved");
  });
});

describe("resetting", () => {
  it("refuses to abandon a sale that is still in flight", () => {
    const inFlight = completionReducer(initialCompletionState, { type: "submit" });
    expect(completionReducer(inFlight, { type: "reset" })).toBe(inFlight);
  });

  it("returns to idle from a finished state", () => {
    const done = drive(initialCompletionState, [
      { type: "submit" },
      answered({ ok: true, status: 201, data: { sale, duplicate: false }, correlationId: "c" }),
    ]);
    expect(completionReducer(done, { type: "reset" })).toEqual({ phase: "idle" });
  });
});

describe("backoff", () => {
  it("grows but stays short enough for a counter", () => {
    expect(reconcileDelayMs(1)).toBeLessThan(reconcileDelayMs(2));
    expect(reconcileDelayMs(10)).toBeLessThanOrEqual(3000);
  });
});
