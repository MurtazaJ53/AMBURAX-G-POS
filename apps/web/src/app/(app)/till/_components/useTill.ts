"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  billLinesForSubmission,
  billReducer,
  billTotals,
  emptyBill,
  newIdempotencyKey,
} from "@/client/pos/bill";
import {
  completionReducer,
  initialCompletionState,
  canSubmit as canSubmitSale,
  reconcileDelayMs,
} from "@/client/pos/completion";
import { classifyScan, type ScanOutcome } from "@/client/pos/scanResult";
import { initialSessionState, sessionReducer, activeSession } from "@/client/pos/session";
import * as api from "@/client/pos/posApi";
import type { CreateSaleRequest } from "@/client/pos/posApi";
import { presentError, type PresentedError } from "@/client/platform/errorCatalog";
import type { CatalogItem, CustomerHit, PaymentMethod, PosDevice } from "@/client/pos/types";
import { offlineStore } from "@/client/pos/offlineStore";

/**
 * Everything the till does, wired to the reducers that decide what it means.
 *
 * The rule this hook follows throughout: it owns *when* things happen — a keystroke, a network
 * answer, a retry timer — and owns none of what they mean. Every interpretation lives in a pure
 * reducer that can be tested without a browser, which is why the bill, the shift and the
 * completion machine each have their own test file.
 */

/** Which terminal this browser is standing at. A preference, not a credential. */
const DEVICE_KEY = "amburax.till.deviceId";

function readStoredDevice(): string | null {
  try {
    return window.localStorage.getItem(DEVICE_KEY);
  } catch {
    // Private windows and locked-down kiosks throw here. A till that cannot remember its
    // terminal still works; one that crashes reading a preference does not.
    return null;
  }
}

function storeDevice(id: string): void {
  try {
    window.localStorage.setItem(DEVICE_KEY, id);
  } catch {
    /* preference only */
  }
}

export interface DeviceState {
  phase: "loading" | "ready" | "error";
  devices: PosDevice[];
  error: PresentedError | null;
}

/**
 * Opening cash for the current shift. `suggestedMinor` is the cash counted when this terminal last
 * closed (a suggestion the cashier confirms or corrects); `recordedMinor` is what this shift has on
 * record. `phase: "unavailable"` means the lookup failed — selling is never blocked on it.
 */
export interface OpeningCashState {
  phase: "loading" | "ready" | "unavailable";
  suggestedMinor: number | null;
  fromClosedAt: string | null;
  recordedMinor: number | null;
  saving: boolean;
  error: string | null;
}

const OPENING_INITIAL: OpeningCashState = {
  phase: "loading",
  suggestedMinor: null,
  fromClosedAt: null,
  recordedMinor: null,
  saving: false,
  error: null,
};

export function useTill(currentUserId: string) {
  const [devices, setDevices] = useState<DeviceState>({
    phase: "loading",
    devices: [],
    error: null,
  });
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const [session, dispatchSession] = useReducer(sessionReducer, initialSessionState);
  const [bill, dispatchBill] = useReducer(billReducer, undefined, () =>
    emptyBill(newIdempotencyKey()),
  );
  const [completion, dispatchCompletion] = useReducer(completionReducer, initialCompletionState);

  const [scan, setScan] = useState<ScanOutcome | null>(null);
  const [scanning, setScanning] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [reference, setReference] = useState("");

  /**
   * The request as it was at the moment the operator committed.
   *
   * Frozen in a ref rather than recomputed per attempt, because a retry must repeat the
   * *identical* payload under the identical key. Recomputing it from live state would let a
   * stray keystroke between attempts change what is being confirmed.
   */
  const submission = useRef<CreateSaleRequest | null>(null);

  // --- terminals ---------------------------------------------------------------
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const result = await api.listDevices(controller.signal);
      if (controller.signal.aborted) return;
      if (!result.ok) {
        setDevices({ phase: "error", devices: [], error: presentError(result) });
        return;
      }
      const list = result.data.devices;
      setDevices({ phase: "ready", devices: list, error: null });

      const stored = readStoredDevice();
      const usable = list.filter((device) => device.status === "ACTIVE");
      // Remembered terminal first; a store with exactly one working till needs no choice made
      // for it; otherwise the operator picks, because guessing which till they are standing at
      // is exactly the guess that puts sales on the wrong terminal.
      const remembered = stored ? usable.find((device) => device.id === stored) : undefined;
      const chosen = remembered ?? (usable.length === 1 ? usable[0] : undefined);
      if (chosen) setSelectedDeviceId(chosen.id);
    })();
    return () => controller.abort();
  }, []);

  const selectDevice = useCallback((id: string) => {
    setSelectedDeviceId(id);
    storeDevice(id);
  }, []);

  // --- shift -------------------------------------------------------------------
  useEffect(() => {
    if (!selectedDeviceId) return;
    const controller = new AbortController();
    void (async () => {
      const result = await api.currentSession(selectedDeviceId, controller.signal);
      if (controller.signal.aborted) return;
      dispatchSession({ type: "load_answered", result, currentUserId });
    })();
    return () => controller.abort();
  }, [selectedDeviceId, currentUserId]);

  // --- opening cash --------------------------------------------------------------
  const [opening, setOpening] = useState<OpeningCashState>(OPENING_INITIAL);
  const activeSessionId = activeSession(session)?.id ?? null;

  useEffect(() => {
    if (!selectedDeviceId) return;
    const controller = new AbortController();
    void (async () => {
      const result = await api.openingCash(selectedDeviceId, activeSessionId ?? undefined, controller.signal);
      if (controller.signal.aborted) return;
      setOpening((prev) =>
        result.ok
          ? {
              ...prev,
              phase: "ready",
              suggestedMinor: result.data.suggestedMinor,
              fromClosedAt: result.data.fromClosedAt,
              recordedMinor: result.data.sessionFloatMinor,
            }
          : { ...prev, phase: "unavailable" },
      );
    })();
    return () => controller.abort();
  }, [selectedDeviceId, activeSessionId]);

  const recordOpening = useCallback(async (sessionId: string, amountMinor: number) => {
    setOpening((prev) => ({ ...prev, saving: true, error: null }));
    const result = await api.recordOpeningCash(sessionId, amountMinor);
    setOpening((prev) =>
      result.ok
        ? { ...prev, saving: false, recordedMinor: amountMinor }
        : {
            ...prev,
            saving: false,
            error: result.kind === "api" ? result.message : "Couldn't save the opening cash. Try again.",
          },
    );
    return result.ok;
  }, []);

  /** Open the shift, then record the opening cash the cashier confirmed (when given). */
  const openShift = useCallback(
    async (openingMinor?: number | null) => {
      if (!selectedDeviceId) return;
      dispatchSession({ type: "open" });
      const result = await api.openSession(selectedDeviceId);
      dispatchSession({ type: "open_answered", result, status: result.ok ? result.status : 0 });
      if (result.ok && openingMinor != null && !result.data.resumed) {
        await recordOpening(result.data.session.id, openingMinor);
      }
    },
    [selectedDeviceId, recordOpening],
  );

  const closeShift = useCallback(
    async (closingNote: string) => {
      const open = activeSession(session);
      if (!open) return;
      dispatchSession({ type: "close" });
      const result = await api.closeSession(open.id, closingNote.trim() || undefined);
      dispatchSession({ type: "close_answered", result });
    },
    [session],
  );

  // --- scanning ----------------------------------------------------------------
  const submitScan = useCallback(async (barcode: string) => {
    const trimmed = barcode.trim();
    if (trimmed.length === 0) return;
    setScanning(true);
    let result = await api.scanBarcode(trimmed);

    // Offline fallback if network is down or request failed
    if (!result.ok) {
      const offlineHit = await offlineStore.scanOfflineBarcode(trimmed).catch(() => null);
      if (offlineHit) {
        result = {
          ok: true,
          status: 200,
          data: { item: offlineHit },
          correlationId: "offline-cached",
        };
      }
    }

    const outcome = classifyScan(trimmed, result);
    setScan(outcome);
    setScanning(false);
    // Only a live item reaches the bill. A withdrawn one is announced and refused; an unknown
    // barcode is announced as unknown. The reducer refuses an inactive item as well, so this
    // is a decision made twice on purpose.
    if (outcome.kind === "found") dispatchBill({ type: "scanned", item: outcome.item });
  }, []);

  const clearScan = useCallback(() => setScan(null), []);

  /** A product picked from name/SKU search goes on the bill like a scan. */
  const pickItem = useCallback((item: CatalogItem) => {
    setScan(null);
    dispatchBill({ type: "picked", item });
  }, []);

  // --- customer ----------------------------------------------------------------
  const attachCustomer = useCallback((customer: CustomerHit) => {
    dispatchBill({ type: "customer_attached", customer });
  }, []);
  const clearCustomer = useCallback(() => dispatchBill({ type: "customer_cleared" }), []);

  // --- completion --------------------------------------------------------------
  const totals = useMemo(() => billTotals(bill), [bill]);

  const takePayment = useCallback(() => {
    if (!canSubmitSale(completion)) return;
    if (bill.lines.length === 0) return;
    const open = activeSession(session);
    submission.current = {
      idempotencyKey: bill.idempotencyKey,
      lines: billLinesForSubmission(bill),
      customerId: bill.customer?.id ?? null,
      posSessionId: open?.id ?? null,
      payment: reference.trim() ? { method, reference: reference.trim() } : { method },
    };
    dispatchCompletion({ type: "submit" });
  }, [bill, completion, session, method, reference]);

  /**
   * The attempt currently in flight, or zero.
   *
   * Extracted so the effect below can depend on "which attempt" rather than on the whole
   * completion object — a new attempt must fire a request, a re-render must not.
   */
  const inFlightAttempt =
    completion.phase === "submitting" || completion.phase === "reconciling"
      ? completion.attempt
      : 0;

  // One effect drives both the first attempt and every reconciliation, because they are the
  // same request. Nothing here decides whether a retry is safe — the machine already did.
  useEffect(() => {
    if (inFlightAttempt === 0) return;
    const request = submission.current;
    if (!request) return;
    let live = true;
    void (async () => {
      let result = await api.createSale(request);

      // If the browser is explicitly offline, enqueue in durable local queue
      if (!result.ok && typeof navigator !== "undefined" && navigator.onLine === false) {
        await offlineStore.enqueueSale({
          idempotencyKey: request.idempotencyKey,
          request,
          totalMinor: totals.totalMinor,
          itemCount: bill.lines.reduce((acc, l) => acc + l.quantity, 0),
          createdAt: Date.now(),
          status: "PENDING",
          retryCount: 0,
        }).catch(() => undefined);

        // Synthesize an offline completed receipt
        result = {
          ok: true,
          status: 200,
          data: {
            sale: {
              id: `offline-${request.idempotencyKey.slice(0, 12)}`,
              billNumber: `OFF-${request.idempotencyKey.slice(-6).toUpperCase()}`,
              totalMinor: totals.totalMinor,
              subtotalMinor: totals.subtotalMinor,
              taxMinor: totals.taxMinor,
              discountMinor: 0,
              paidMinor: totals.totalMinor,
              paymentStatus: "CONFIRMED",
              erpSyncStatus: "QUEUED_OFFLINE",
              completedAt: new Date().toISOString(),
            },
            duplicate: false,
          },
          correlationId: "offline-queued",
        };
      }

      if (live) dispatchCompletion({ type: "answered", result });
    })();
    return () => {
      // The request is not cancelled — only this component's interest in it. Aborting an
      // in-flight sale is precisely how an unknown outcome is manufactured.
      live = false;
    };
  }, [inFlightAttempt, totals, bill.lines]);

  const unresolvedAttempt = completion.phase === "unresolved" ? completion.attempt : 0;

  useEffect(() => {
    if (unresolvedAttempt === 0) return;
    const timer = setTimeout(
      () => dispatchCompletion({ type: "reconcile" }),
      reconcileDelayMs(unresolvedAttempt),
    );
    return () => clearTimeout(timer);
  }, [unresolvedAttempt]);

  const startNewBill = useCallback(() => {
    submission.current = null;
    dispatchCompletion({ type: "reset" });
    dispatchBill({ type: "cleared", idempotencyKey: newIdempotencyKey() });
    setScan(null);
    setReference("");
    setMethod("CASH");
  }, []);

  const selectedDevice = useMemo(
    () => devices.devices.find((device) => device.id === selectedDeviceId) ?? null,
    [devices.devices, selectedDeviceId],
  );

  return {
    devices,
    selectedDevice,
    selectDevice,
    session,
    dispatchSession,
    openShift,
    closeShift,
    opening,
    recordOpening,
    pickItem,
    bill,
    dispatchBill,
    totals,
    scan,
    scanning,
    submitScan,
    clearScan,
    attachCustomer,
    clearCustomer,
    method,
    setMethod,
    reference,
    setReference,
    completion,
    takePayment,
    startNewBill,
  };
}
