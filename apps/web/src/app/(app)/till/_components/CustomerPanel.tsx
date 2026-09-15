"use client";

import { forwardRef, useEffect, useRef, useState } from "react";
import * as api from "@/client/pos/posApi";
import { presentError, type PresentedError } from "@/client/platform/errorCatalog";
import type { CustomerHit } from "@/client/pos/types";
import { Button, Panel, inputClass } from "./primitives";
import { ErrorBanner } from "./ErrorBanner";

/**
 * Attaching a customer to the bill — always optional.
 *
 * Walk-in is the default and needs no action, because most retail sales have no customer and a
 * till that insists on one adds a step to every transaction to serve a minority of them.
 *
 * The search is tenant-scoped by the server from the session; there is no tenant parameter to
 * send and none is invented here. A blank query returns nothing by design, so the panel does
 * not fish for a customer list.
 */

const SEARCH_DEBOUNCE_MS = 200;

export const CustomerPanel = forwardRef<
  HTMLInputElement,
  {
    customer: CustomerHit | null;
    onAttach: (customer: CustomerHit) => void;
    onClear: () => void;
    disabled: boolean;
  }
>(function CustomerPanel({ customer, onAttach, onClear, disabled }, ref) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerHit[]>([]);
  const [error, setError] = useState<PresentedError | null>(null);
  const [searching, setSearching] = useState(false);
  /** The term the displayed results belong to — a result for an older term is simply not shown. */
  const settledTerm = useRef("");

  useEffect(() => {
    const term = query.trim();
    if (term.length === 0) {
      setResults([]);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      void (async () => {
        const result = await api.searchCustomers(term, controller.signal);
        if (controller.signal.aborted) return;
        setSearching(false);
        settledTerm.current = term;
        if (!result.ok) {
          setResults([]);
          setError(presentError(result));
          return;
        }
        setError(null);
        setResults(result.data.results);
      })();
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  if (customer) {
    return (
      <Panel title="Customer">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-amb-ink">{customer.name}</p>
            <p className="truncate text-xs text-amb-ink-muted">
              {customer.phone ?? "No phone on file"}
            </p>
          </div>
          <Button tone="ghost" onClick={onClear} disabled={disabled}>
            Remove
          </Button>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Customer">
      <div className="space-y-2 px-4 py-3">
        <label htmlFor="till-customer" className="sr-only">
          Search for a customer by name or phone
        </label>
        <input
          id="till-customer"
          ref={ref}
          className={inputClass}
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Walk-in — search by name or phone to attach"
          autoComplete="off"
        />

        {error && <ErrorBanner error={error} onDismiss={() => setError(null)} />}

        <div aria-live="polite">
          {searching && <p className="text-xs text-amb-ink-muted">Searching…</p>}
          {!searching && query.trim().length > 0 && results.length === 0 && !error && (
            <p className="text-xs text-amb-ink-muted">No customer matches that.</p>
          )}
        </div>

        {results.length > 0 && settledTerm.current === query.trim() && (
          <ul className="max-h-48 space-y-1 overflow-y-auto">
            {results.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  onClick={() => {
                    onAttach(hit);
                    setQuery("");
                    setResults([]);
                  }}
                  className="min-h-touch w-full rounded-amb px-3 py-2 text-left hover:bg-amb-sunken"
                >
                  <span className="block text-sm font-medium text-amb-ink">{hit.name}</span>
                  <span className="block text-xs text-amb-ink-muted">
                    {hit.phone ?? "No phone on file"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
});
