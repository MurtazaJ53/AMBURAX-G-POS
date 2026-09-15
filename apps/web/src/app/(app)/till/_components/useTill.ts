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
import type { CustomerHit, PaymentMethod, PosDevice } from "@/client/pos/types";

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

  const openShift = useCallback(async () => {
    if (!selectedDeviceId) return;
    dispatchSession({ type: "open" });
    const result = await api.openSession(selectedDeviceId);
    dispatchSession({ type: "open_answered", result, status: result.ok ? result.status : 0 });
  }, [selectedDeviceId]);

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
    const result = await api.scanBarcode(trimmed);
    const outcome = classifyScan(trimmed, result);
    setScan(outcome);
    setScanning(false);
    // Only a live item reaches the bill. A withdrawn one is announced and refused; an unknown
    // barcode is announced as unknown. The reducer refuses an inactive item as well, so this
    // is a decision made twice on purpose.
    if (outcome.kind === "found") dispatchBill({ type: "scanned", item: outcome.item });
  }, []);

  const clearScan = useCallback(() => setScan(null), []);

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
      const result = await api.createSale(request);
      if (live) dispatchCompletion({ type: "answered", result });
    })();
    return () => {
      // The request is not cancelled — only this component's interest in it. Aborting an
      // in-flight sale is precisely how an unknown outcome is manufactured.
      live = false;
    };
  }, [inFlightAttempt]);

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
