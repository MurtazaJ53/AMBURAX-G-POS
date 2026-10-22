"use client";

import { forwardRef, useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { searchCatalog } from "@/client/pos/posApi";
import type { CatalogItem } from "@/client/pos/types";
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
 * ## One box, two paths that never mix
 *
 * Enter always runs the exact-barcode lookup — a scanner types and presses Enter, and a fuzzy
 * match must never put the wrong variant on a bill. While a person types (two or more
 * characters), name/SKU suggestions appear below; only an explicit choice (click, or arrow keys
 * then Enter) adds a suggestion. Shops whose stock has no barcodes sell from search alone.
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
    onPick: (item: CatalogItem) => void;
    scanning: boolean;
    outcome: ScanOutcome | null;
    onDismiss: () => void;
    disabled: boolean;
    disabledReason?: string;
  }
>(function ScanBar({ onScan, onPick, scanning, outcome, onDismiss, disabled, disabledReason }, ref) {
  const [value, setValue] = useState("");
  const [hits, setHits] = useState<CatalogItem[]>([]);
  const [active, setActive] = useState(-1);
  const query = value.trim();

  // Debounced name/SKU search. A scanner finishes and presses Enter well inside the debounce,
  // which clears the field, so scans never trigger a search.
  useEffect(() => {
    if (disabled || query.length < 2) {
      setHits([]);
      setActive(-1);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const result = await searchCatalog(query, controller.signal);
      if (controller.signal.aborted) return;
      setHits(result.ok ? result.data.results.slice(0, 8) : []);
      setActive(-1);
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, disabled]);

  function pick(item: CatalogItem) {
    onPick(item);
    setValue("");
    setHits([]);
    setActive(-1);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (hits.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i <= 0 ? hits.length - 1 : i - 1));
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled) return;
    if (active >= 0 && hits[active]) {
      pick(hits[active]!);
      return;
    }
    const barcode = value.trim();
    if (!barcode) return;
    setHits([]);
    onScan(barcode);
    // Cleared immediately so the next scan lands in an empty field. The scanner will not wait
    // for the network, and neither should the cashier.
    setValue("");
  }

  return (
    <div className="space-y-3">
      <form onSubmit={submit}>
        <label htmlFor="till-scan" className="sr-only">
          Scan or type a barcode, or search by name or SKU
        </label>
        <div className="relative">
          <input
            id="till-scan"
            ref={ref}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded={hits.length > 0}
            aria-controls="till-scan-results"
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `till-hit-${active}` : undefined}
            disabled={disabled}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode="text"
            placeholder={disabled ? (disabledReason ?? "Not ready") : "Scan a barcode or type a name / SKU"}
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
          {hits.length > 0 && (
            <ul
              id="till-scan-results"
              role="listbox"
              aria-label="Matching products"
              className="amb-fade-in absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-amb-lg border border-amb-line bg-amb-raised p-1 shadow-amb"
            >
              {hits.map((item, i) => (
                <li
                  key={item.variantId}
                  id={`till-hit-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    pick(item);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`flex min-h-touch cursor-pointer items-center justify-between gap-3 rounded-amb px-3 py-2 transition-colors duration-100 ${
                    i === active ? "bg-amb-accent-soft" : "hover:bg-amb-sunken"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-amb-ink">{item.productName}</span>
                    <span className="block truncate text-xs text-amb-ink-secondary">
                      {item.sku}
                      {item.size ? ` · ${item.size}` : ""}
                      {item.colour ? ` · ${item.colour}` : ""}
                      {` · ${stockLabel(item.stockQuantity)}`}
                    </span>
                  </span>
                  <span className="amb-tnum shrink-0 text-sm font-semibold text-amb-ink">
                    {formatMinor(item.priceMinor)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p id="till-scan-hint" className="mt-1.5 text-xs text-amb-ink-muted">
          Enter looks up a barcode. Type 2+ letters to search by name or SKU, ↑↓ to choose. F2 returns here.
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
