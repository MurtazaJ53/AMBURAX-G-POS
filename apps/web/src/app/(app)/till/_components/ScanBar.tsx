"use client";

import { forwardRef, useState, type FormEvent } from "react";
import { stockLabel, type ScanOutcome } from "@/client/pos/scanResult";
import { formatMinor } from "@/server/sales/saleTotals";
import { Chip, Kbd } from "./primitives";
import { ErrorBanner } from "./ErrorBanner";

/**
 * The scan field — the one control the till is built around.
 *
 * ## Why it is a form and not a keystroke listener
 *
 * A hardware barcode scanner is a keyboard that types very fast and presses Enter. So the
 * fastest, most compatible thing a POS can offer it is an ordinary focused text input inside a
 * form: no timing heuristics, no key-interval guessing, no driver assumptions. It also means
 * the same field serves a cashier typing a barcode by hand when a label will not read.
 *
 * ## Why this is not the search box
 *
 * It calls the exact-barcode endpoint, never catalogue search. Search runs a `contains` match
 * across SKU and product name, which is right for a person browsing and dangerous for a
 * scanner — a fuzzy match that lands on the wrong variant puts the wrong item on a bill and
 * nobody notices until the customer gets home.
 *
 * ## Feedback
 *
 * The three outcomes a counter confuses are given three different messages, deliberately
 * worded so they cannot be mistaken for one another: an unknown barcode, a withdrawn item, and
 * a lookup that failed. Stock is shown but never blocks a scan, and "never counted" is never
 * rendered as zero.
 */

export const ScanBar = forwardRef<
  HTMLInputElement,
  {
    onScan: (barcode: string) => void;
    scanning: boolean;
    outcome: ScanOutcome | null;
    onDismiss: () => void;
    disabled: boolean;
    disabledReason?: string;
  }
>(function ScanBar({ onScan, scanning, outcome, onDismiss, disabled, disabledReason }, ref) {
  const [value, setValue] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled) return;
    const barcode = value.trim();
    if (!barcode) return;
    onScan(barcode);
    // Cleared immediately so the next scan lands in an empty field. The scanner will not wait
    // for the network, and neither should the cashier.
    setValue("");
  }

  return (
    <div className="space-y-3">
      <form onSubmit={submit}>
        <label htmlFor="till-scan" className="sr-only">
          Scan or type a barcode
        </label>
        <div className="relative">
          <input
            id="till-scan"
            ref={ref}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            disabled={disabled}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode="text"
            placeholder={disabled ? (disabledReason ?? "Not ready") : "Scan or type a barcode"}
            aria-describedby="till-scan-hint"
            className="h-16 w-full rounded-amb-lg border-2 border-amb-line-strong bg-amb-raised px-5 pr-28 text-lg font-medium text-amb-ink placeholder:text-amb-ink-muted focus:border-amb-accent disabled:bg-amb-sunken disabled:text-amb-ink-muted"
          />
          <div className="pointer-events-none absolute inset-y-0 right-4 flex items-center gap-2">
            {scanning && (
              <span className="text-xs font-semibold text-amb-ink-muted" role="status">
                Looking up…
              </span>
            )}
            <Kbd>F2</Kbd>
          </div>
        </div>
        <p id="till-scan-hint" className="mt-1.5 text-xs text-amb-ink-muted">
          Press F2 from anywhere to return here. A scanner works without any setup.
        </p>
      </form>

      <div aria-live="polite" className="empty:hidden">
        {outcome?.kind === "found" && (
          <div className="flex items-center justify-between gap-3 rounded-amb border border-amb-positive/30 bg-amb-positive-soft px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-amb-ink">
                {outcome.item.productName}
              </p>
              <p className="truncate text-xs text-amb-ink-secondary">
                {outcome.item.sku}
                {outcome.item.size ? ` · ${outcome.item.size}` : ""}
                {outcome.item.colour ? ` · ${outcome.item.colour}` : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <Chip tone={outcome.item.stockQuantity === null ? "neutral" : "info"}>
                {stockLabel(outcome.item.stockQuantity)}
              </Chip>
              <span className="amb-tnum text-sm font-semibold text-amb-ink">
                {formatMinor(outcome.item.priceMinor)}
              </span>
            </div>
          </div>
        )}

        {outcome?.kind === "not_for_sale" && (
          <ErrorBanner
            onDismiss={onDismiss}
            error={{
              title: "Not for sale",
              // Named, not hidden. The cashier can tell the customer which item it is, which
              // is the whole reason the API returns a withdrawn variant instead of a 404.
              detail: `${outcome.item.productName} (${outcome.item.sku}) has been withdrawn from sale.`,
              recovery: "It cannot be added to this bill. Ask a manager if it should be back on sale.",
              severity: "blocking",
              correlationId: null,
            }}
          />
        )}

        {outcome?.kind === "not_found" && (
          <ErrorBanner
            onDismiss={onDismiss}
            error={{
              title: "Barcode not found",
              detail: `Nothing in this catalogue matches ${outcome.barcode}.`,
              recovery: "Check the label, or find the item by name in search.",
              severity: "recoverable",
              correlationId: null,
            }}
          />
        )}

        {outcome?.kind === "error" && <ErrorBanner error={outcome.error} onDismiss={onDismiss} />}
      </div>
    </div>
  );
});
