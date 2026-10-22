"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { billItemCount } from "@/client/pos/bill";
import { isSellable } from "@/client/pos/session";
import { useTill } from "./useTill";
import { StatusRail } from "./StatusRail";
import { SessionPanel } from "./SessionPanel";
import { ScanBar } from "./ScanBar";
import { BillPanel } from "./BillPanel";
import { CustomerPanel } from "./CustomerPanel";
import { PaymentPanel } from "./PaymentPanel";
import { CompletionPanel } from "./CompletionPanel";
import { Kbd } from "./primitives";
import { OperatorBar } from "./OperatorBar";

/**
 * The POS command surface.
 *
 * ## The shape of the screen is the shape of the job
 *
 * SCAN → REVIEW → PAY → COMPLETE, laid out left to right and top to bottom in that order. The
 * scan field is the tallest control on the page and holds focus by default; the bill is the
 * largest region; the total is the largest number; payment is one column away and completion
 * takes the screen. Nothing else competes for the centre, and there is no form to fill in
 * before a cashier can start.
 *
 * ## Keyboard first
 *
 * F2 returns to the scan field from anywhere, F4 jumps to the customer field, F9 takes payment
 * and then starts the next bill, Escape clears the last scan message. These are real shortcuts
 * on a real key row, chosen because a cashier's hands are on a scanner and a cash tray rather
 * than on a mouse. They are listed in a region a screen reader can reach, not only printed on
 * the buttons.
 *
 * ## What gates what
 *
 * Selling is gated on an open shift belonging to this cashier, on this terminal. That gate is
 * for the operator's clarity only — the sale API re-derives every part of it server-side and
 * would refuse regardless, which is the point of Rule 9: the frontend never holds a permission
 * decision, it only avoids wasting the cashier's time discovering one.
 */

export function TillWorkspace({
  currentUserId,
  cashierName,
  roleLabel,
  storeName,
  storeCode,
}: {
  currentUserId: string;
  cashierName: string;
  roleLabel: string;
  storeName: string;
  storeCode: string;
}) {
  const till = useTill(currentUserId);
  const router = useRouter();
  const scanRef = useRef<HTMLInputElement>(null);
  const customerRef = useRef<HTMLInputElement>(null);

  const sellable = isSellable(till.session);
  const finished = till.completion.phase !== "idle";
  const busy = till.completion.phase === "submitting" || till.completion.phase === "reconciling";

  const focusScan = useCallback(() => scanRef.current?.focus(), []);

  /**
   * A completed sale invalidates server-rendered screens elsewhere.
   *
   * Sales history, the dashboard figures and stock counts are all rendered on the server and
   * held in the router cache; a sale rung up here makes every one of them stale. Refreshing
   * once, on completion, is the whole of the cache story on this surface — the till itself
   * holds no cached server state to invalidate, because it reads what it needs when it needs
   * it. A duplicate replay refreshes too: it is the first time *this* browser has seen the
   * sale, even though the server recorded it earlier.
   */
  useEffect(() => {
    if (till.completion.phase === "completed") router.refresh();
  }, [till.completion.phase, router]);

  // The scan field takes focus as soon as the till is ready to sell, and again after each
  // completed bill — a cashier should never have to click before scanning. If the cashier has
  // already jumped to the customer field (F4 pressed before this effect ran), that choice wins.
  useEffect(() => {
    if (!sellable || finished) return;
    if (customerRef.current && document.activeElement === customerRef.current) return;
    focusScan();
  }, [sellable, finished, focusScan]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "F2") {
        event.preventDefault();
        focusScan();
        return;
      }
      if (event.key === "F4") {
        event.preventDefault();
        customerRef.current?.focus();
        return;
      }
      if (event.key === "F9") {
        event.preventDefault();
        // The same key ends one bill and begins the next, so the rhythm of a queue is one key.
        if (till.completion.phase === "completed") till.startNewBill();
        else if (!busy) till.takePayment();
        return;
      }
      if (event.key === "Escape") {
        if (till.completion.phase === "completed") {
          till.startNewBill();
          return;
        }
        till.clearScan();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [till, busy, focusScan]);

  const itemCount = billItemCount(till.bill);

  return (
    <div
      data-amburax
      className="flex min-h-screen flex-col gap-4 bg-amb-surface p-4 text-amb-ink lg:h-screen lg:overflow-hidden"
    >
      <StatusRail
        cashierName={cashierName}
        roleLabel={roleLabel}
        storeName={storeName}
        storeCode={storeCode}
        device={till.selectedDevice}
        session={till.session}
      />

      <OperatorBar signedInName={cashierName} />

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
        {/* --- scan and bill ------------------------------------------------ */}
        <div className="flex min-h-0 flex-col gap-4">
          {finished ? (
            <div className="min-h-0 flex-1 rounded-amb-lg border border-amb-line bg-amb-raised shadow-amb">
              <CompletionPanel completion={till.completion} onNewBill={till.startNewBill} />
            </div>
          ) : (
            <>
              <ScanBar
                ref={scanRef}
                onScan={till.submitScan}
                onPick={till.pickItem}
                scanning={till.scanning}
                outcome={till.scan}
                onDismiss={till.clearScan}
                disabled={!sellable}
                disabledReason="Open a shift to start scanning"
              />
              {sellable ? (
                <BillPanel
                  bill={till.bill}
                  totals={till.totals}
                  dispatch={till.dispatchBill}
                  readOnly={busy}
                />
              ) : (
                // Before a shift is open, the centre of the screen is the start-of-shift steps —
                // the one thing the cashier can do next.
                <div className="amb-fade-in mx-auto w-full max-w-xl">
                  <SessionPanel
                    devices={till.devices}
                    selectedDevice={till.selectedDevice}
                    onSelectDevice={till.selectDevice}
                    session={till.session}
                    opening={till.opening}
                    onOpen={(minor) => void till.openShift(minor)}
                    onRecordOpening={(id, minor) => void till.recordOpening(id, minor)}
                    onClose={(note) => void till.closeShift(note)}
                    onDismiss={() => till.dispatchSession({ type: "dismiss" })}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* --- shift, customer, payment -------------------------------------- */}
        {/* `[&>*]:shrink-0` is load-bearing, not tidiness.
            Every panel in this column is a flex item, and `Panel` carries `min-h-0` so the bill
            can scroll on the other side. Together those remove the automatic minimum size, so
            when the column's content is taller than the column — which it is at 1440x900 with a
            shift open — the panels collapse instead of the column scrolling. Measured: the
            payment panel's box shrank to 2px while its content still painted 404px tall, and the
            shift panel, ordered last and therefore painted last, covered it. The Take-payment
            button was visible, enabled, and could not be clicked.
            Refusing to shrink gives each panel its natural height and lets `overflow-y-auto` do
            what it was put here to do. */}
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto [&>*]:shrink-0">
          {/* While selling, the shift panel sits below payment, out of the way. Before a shift is
              open it is rendered in the centre instead (left column). */}
          {sellable && (
            <div className="order-3">
              <SessionPanel
                devices={till.devices}
                selectedDevice={till.selectedDevice}
                onSelectDevice={till.selectDevice}
                session={till.session}
                opening={till.opening}
                onOpen={(minor) => void till.openShift(minor)}
                onRecordOpening={(id, minor) => void till.recordOpening(id, minor)}
                onClose={(note) => void till.closeShift(note)}
                onDismiss={() => till.dispatchSession({ type: "dismiss" })}
              />
            </div>
          )}

          <CustomerPanel
            ref={customerRef}
            customer={till.bill.customer}
            onAttach={till.attachCustomer}
            onClear={till.clearCustomer}
            disabled={!sellable || busy || finished}
          />

          <PaymentPanel
            totals={till.totals}
            itemCount={itemCount}
            method={till.method}
            onMethod={till.setMethod}
            reference={till.reference}
            onReference={till.setReference}
            completion={till.completion}
            onTakePayment={till.takePayment}
            blocked={!sellable}
            blockedReason="Open a shift on this terminal before taking payment."
          />

          <section aria-label="Keyboard shortcuts" className="order-4 px-1 pb-2">
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-amb-ink-muted">
              <li>
                <Kbd>F2</Kbd> Scan field
              </li>
              <li>
                <Kbd>F4</Kbd> Customer
              </li>
              <li>
                <Kbd>F9</Kbd> Take payment / next bill
              </li>
              <li>
                <Kbd>Esc</Kbd> Clear message
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
