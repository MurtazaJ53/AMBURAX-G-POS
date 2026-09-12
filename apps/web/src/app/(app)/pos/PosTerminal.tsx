"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  computeSaleTotals,
  formatMinor,
  MAX_LINE_QUANTITY,
  MAX_LINES_PER_SALE,
  type PricedLine,
} from "@/server/sales/saleTotals";

/**
 * The selling screen.
 *
 * Two rules shape everything here:
 *
 * 1. **The totals on screen are a preview, not the price.** They are computed with the
 *    same pure function the server uses, from prices the server sent, so they agree — but
 *    the sale request carries no money at all. The server re-reads every price and
 *    recomputes the total before charging. If the two ever disagree, the server is right.
 * 2. **A sale must never be rung twice.** One idempotency key is minted per cart and
 *    reused for every attempt at that cart, so a double click, an impatient retry or a
 *    flaky connection resolves to the same sale rather than a second one.
 */

interface CatalogHit {
  variantId: string;
  productName: string;
  sku: string;
  barcode: string | null;
  size: string | null;
  colour: string | null;
  priceMinor: number;
  taxRateBp: number;
  stockQuantity: number | null;
}

interface CustomerHit {
  id: string;
  name: string;
  phone: string | null;
}

interface CartLine extends PricedLine {
  variantId: string;
  productName: string;
  sku: string;
  size: string | null;
  colour: string | null;
  stockQuantity: number | null;
}

interface CompletedSale {
  id: string;
  billNumber: string;
  totalMinor: number;
  paidMinor: number;
  erpSyncStatus: string;
  duplicate: boolean;
}

type PaymentMethod = "CASH" | "UPI" | "CARD";

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "CARD", label: "Card" },
];

function variantLabel(line: { size: string | null; colour: string | null }): string {
  return [line.colour, line.size].filter(Boolean).join(" · ");
}

/**
 * A settled search result, tagged with the term that produced it.
 *
 * Carrying the term is what lets "loading", "cleared" and "stale" be *derived* from what
 * is typed rather than tracked as separate state. Flags like `searching` and `searched`
 * have to be cleared in an effect the moment the box is emptied; a tagged result does not,
 * because a result whose term no longer matches the input is simply not displayed.
 */
interface SearchState<T> {
  term: string;
  results: T[];
  error: string | null;
}

const EMPTY_SEARCH = { term: "", results: [], error: null };

export function PosTerminal(props: { storeName: string; storeCode: string; cashierName: string }) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchState<CatalogHit>>(EMPTY_SEARCH);

  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartNotice, setCartNotice] = useState<string | null>(null);

  const [customer, setCustomer] = useState<CustomerHit | null>(null);

  const [method, setMethod] = useState<PaymentMethod>("CASH");
  const [reference, setReference] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [saleError, setSaleError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<CompletedSale | null>(null);

  // One key per cart. Minted when the cart is created and held until the sale succeeds and
  // the operator starts a new one, so every retry of *this* cart carries the same key.
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  const searchInput = useRef<HTMLInputElement>(null);

  // Debounced search. The request is sequenced so a slow earlier response cannot overwrite
  // a fast later one — at a counter, stale results on screen are results the operator will
  // click.
  const requestSeq = useRef(0);
  const term = query.trim();

  useEffect(() => {
    const current = query.trim();
    // Nothing typed means nothing to search. The displayed state is derived below, so
    // there is nothing to clear here either.
    if (current.length === 0) return;

    const seq = ++requestSeq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/catalog/search?q=${encodeURIComponent(current)}`);
        const data = await res.json();
        if (seq !== requestSeq.current) return;
        setSearch(
          res.ok
            ? { term: current, results: data.results as CatalogHit[], error: null }
            : { term: current, results: [], error: data?.error?.message ?? "Product lookup failed." },
        );
      } catch {
        if (seq !== requestSeq.current) return;
        setSearch({
          term: current,
          results: [],
          error: "Product lookup failed. Check the connection and try again.",
        });
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

  // Derived from what is typed and what came back, so emptying the box or typing a new
  // term cannot leave a stale list or a stale spinner on screen.
  const settled = search.term === term;
  const results = settled ? search.results : [];
  const searchError = settled ? search.error : null;
  const searching = term.length > 0 && !settled;
  const searched = settled && term.length > 0;

  const addToCart = useCallback((hit: CatalogHit) => {
    setCartNotice(null);
    setSaleError(null);
    setCart((current) => {
      const existing = current.find((l) => l.variantId === hit.variantId);
      if (existing) {
        if (existing.quantity >= MAX_LINE_QUANTITY) {
          setCartNotice(`A line cannot exceed ${MAX_LINE_QUANTITY} units.`);
          return current;
        }
        return current.map((l) =>
          l.variantId === hit.variantId ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      if (current.length >= MAX_LINES_PER_SALE) {
        setCartNotice(`A sale cannot have more than ${MAX_LINES_PER_SALE} lines.`);
        return current;
      }
      return [
        ...current,
        {
          variantId: hit.variantId,
          productName: hit.productName,
          sku: hit.sku,
          size: hit.size,
          colour: hit.colour,
          stockQuantity: hit.stockQuantity,
          quantity: 1,
          unitPriceMinor: hit.priceMinor,
          taxRateBp: hit.taxRateBp,
        },
      ];
    });
    // Clearing the box is enough: the result list is derived from it.
    setQuery("");
    searchInput.current?.focus();
  }, []);

  function setQuantity(variantId: string, quantity: number) {
    setCartNotice(null);
    if (quantity <= 0) {
      setCart((c) => c.filter((l) => l.variantId !== variantId));
      return;
    }
    if (quantity > MAX_LINE_QUANTITY) {
      setCartNotice(`A line cannot exceed ${MAX_LINE_QUANTITY} units.`);
      return;
    }
    setCart((c) => c.map((l) => (l.variantId === variantId ? { ...l, quantity } : l)));
  }

  // A scan ends with Enter. When exactly one product matched, ring it straight in rather
  // than making the operator move a hand to the mouse.
  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const first = results[0];
    if (results.length === 1 && first) addToCart(first);
  }

  const totals = computeSaleTotals(cart, 0);

  function startNewSale() {
    setCart([]);
    setCustomer(null);
    setMethod("CASH");
    setReference("");
    setCompleted(null);
    setSaleError(null);
    setCartNotice(null);
    setQuery("");
    setSearch(EMPTY_SEARCH);
    // A new cart is a new sale, so it gets a new key. This is the only place the key
    // changes; anything else would let a retry create a second sale.
    idempotencyKey.current = crypto.randomUUID();
    searchInput.current?.focus();
  }

  async function completeSale() {
    if (cart.length === 0 || submitting) return;
    setSubmitting(true);
    setSaleError(null);

    try {
      const res = await fetch("/api/v1/sales", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: idempotencyKey.current,
          lines: cart.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
          customerId: customer?.id ?? null,
          payment: {
            method,
            reference: reference.trim() ? reference.trim() : undefined,
          },
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setSaleError(data?.error?.message ?? "The sale could not be completed.");
        return;
      }

      setCompleted({
        id: data.sale.id,
        billNumber: data.sale.billNumber,
        totalMinor: data.sale.totalMinor,
        paidMinor: data.sale.paidMinor,
        erpSyncStatus: data.sale.erpSyncStatus,
        duplicate: Boolean(data.duplicate),
      });
    } catch {
      // The request never completed, so whether the sale committed is genuinely unknown.
      // Saying "nothing was charged" here would be a guess; the idempotency key makes
      // retrying safe, and that is what the operator is told to do.
      setSaleError(
        "We couldn't reach the server. Check the connection and press Complete sale again — this will not charge twice.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (completed) {
    return (
      <SaleSuccess sale={completed} customerName={customer?.name ?? null} onNewSale={startNewSale} />
    );
  }

  return (
    <div className="flex min-h-screen flex-col gap-4 p-4 lg:flex-row">
      {/* Catalogue side */}
      <section className="flex min-w-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label htmlFor="pos-search" className="text-sm font-medium text-slate-700">
          Scan or search
        </label>
        <input
          id="pos-search"
          ref={searchInput}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder="Barcode, SKU or product name"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
        />

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {searching && <p className="py-6 text-center text-sm text-slate-400">Searching…</p>}

          {searchError && (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {searchError}
            </p>
          )}

          {!searching && !searchError && searched && results.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-500">
              Nothing matches &ldquo;{query.trim()}&rdquo;.
            </p>
          )}

          {!searching && !searchError && !searched && (
            <p className="py-6 text-center text-sm text-slate-400">
              Scan an item or start typing to find it.
            </p>
          )}

          <ul className="divide-y divide-slate-100">
            {results.map((hit) => (
              <li key={hit.variantId}>
                <button
                  type="button"
                  onClick={() => addToCart(hit)}
                  className="flex w-full items-center justify-between gap-3 px-1 py-3 text-left hover:bg-slate-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-900">
                      {hit.productName}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {hit.sku}
                      {variantLabel(hit) && ` · ${variantLabel(hit)}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-medium text-slate-900">
                      {formatMinor(hit.priceMinor)}
                    </span>
                    {/*
                      Null stock is genuinely different from zero: the variant has never
                      been counted in this store. Rendering it as "0 in stock" would be a
                      figure the system does not have.
                    */}
                    <span className="block text-xs text-slate-400">
                      {hit.stockQuantity === null ? "Not counted" : `${hit.stockQuantity} in stock`}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Cart side */}
      <section className="flex w-full flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:max-w-md">
        <header className="flex items-baseline justify-between gap-2">
          <h1 className="text-base font-semibold text-slate-900">Current sale</h1>
          {/* The sidebar that names the store is hidden on narrow screens, and a till is
              often a tablet — so the store is named here too. An operator must never be
              unsure which store they are ringing into. */}
          <span className="truncate text-xs text-slate-500">
            {props.storeName} ({props.storeCode}) · {props.cashierName}
          </span>
        </header>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {cart.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">
              No items yet. Scan or search to begin.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {cart.map((line) => (
                <li key={line.variantId} className="flex items-start gap-2 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{line.productName}</p>
                    <p className="truncate text-xs text-slate-500">
                      {line.sku}
                      {variantLabel(line) && ` · ${variantLabel(line)}`}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatMinor(line.unitPriceMinor)} each
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Decrease quantity of ${line.productName}`}
                      onClick={() => setQuantity(line.variantId, line.quantity - 1)}
                      className="h-8 w-8 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
                    >
                      &minus;
                    </button>
                    <input
                      aria-label={`Quantity of ${line.productName}`}
                      inputMode="numeric"
                      value={line.quantity}
                      onChange={(e) => {
                        const next = Number.parseInt(e.target.value, 10);
                        if (Number.isNaN(next)) return;
                        setQuantity(line.variantId, next);
                      }}
                      className="h-8 w-12 rounded-lg border border-slate-300 text-center text-sm"
                    />
                    <button
                      type="button"
                      aria-label={`Increase quantity of ${line.productName}`}
                      onClick={() => setQuantity(line.variantId, line.quantity + 1)}
                      className="h-8 w-8 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
                    >
                      +
                    </button>
                  </div>
                  <p className="w-20 shrink-0 text-right text-sm font-medium text-slate-900">
                    {formatMinor(line.unitPriceMinor * line.quantity)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {cartNotice && (
          <p role="alert" className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {cartNotice}
          </p>
        )}

        <CustomerPicker customer={customer} onChange={setCustomer} />

        <dl className="mt-4 space-y-1 border-t border-slate-200 pt-3 text-sm">
          <div className="flex justify-between text-slate-600">
            <dt>Subtotal</dt>
            <dd>{formatMinor(totals.subtotalMinor)}</dd>
          </div>
          {/* Prices are tax-inclusive (ADR-081), so tax is shown as a component of the
              total rather than added to it. Saying "included" is what stops an operator
              reading the total as subtotal plus tax. */}
          <div className="flex justify-between text-slate-600">
            <dt>Tax (included)</dt>
            <dd>{formatMinor(totals.taxMinor)}</dd>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-900">
            <dt>Total</dt>
            <dd>{formatMinor(totals.totalMinor)}</dd>
          </div>
        </dl>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-slate-700">Payment</legend>
          <div className="mt-2 flex gap-2">
            {PAYMENT_METHODS.map((m) => (
              <button
                key={m.value}
                type="button"
                aria-pressed={method === m.value}
                onClick={() => setMethod(m.value)}
                className={
                  method === m.value
                    ? "flex-1 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white"
                    : "flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                }
              >
                {m.label}
              </button>
            ))}
          </div>

          {method !== "CASH" && (
            <div className="mt-2">
              <label htmlFor="pos-reference" className="text-xs text-slate-600">
                Reference (optional)
              </label>
              <input
                id="pos-reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                maxLength={100}
                placeholder="Last 4 digits, UPI reference…"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              {/*
                No gateway is integrated. The operator confirms on their own terminal or
                UPI app and records the reference here; the system must not imply it
                verified the payment itself.
              */}
              <p className="mt-1 text-xs text-slate-500">
                Recorded as taken on your own {method === "UPI" ? "UPI app" : "card terminal"} —
                AMBURAX doesn&apos;t process the payment.
              </p>
            </div>
          )}
        </fieldset>

        {saleError && (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {saleError}
          </p>
        )}

        <button
          type="button"
          onClick={completeSale}
          disabled={cart.length === 0 || submitting}
          className="mt-4 w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {submitting ? "Completing…" : `Complete sale · ${formatMinor(totals.totalMinor)}`}
        </button>
      </section>
    </div>
  );
}

/**
 * Customer attach.
 *
 * Searching never creates. Creating is a separate, explicit action, and the server
 * resolves a repeated phone number to the existing customer, so a busy counter cannot
 * accumulate three records for the same person.
 */
function CustomerPicker(props: {
  customer: CustomerHit | null;
  onChange: (customer: CustomerHit | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [search, setSearch] = useState<SearchState<CustomerHit>>(EMPTY_SEARCH);
  // Kept apart from the search state: a failure to *add* a customer is the operator's
  // problem to fix, and must not be wiped out by the next keystroke in the search box.
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const seq = useRef(0);
  const q = term.trim();

  useEffect(() => {
    if (!open) return;
    const current = term.trim();
    if (current.length === 0) return;

    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/customers?q=${encodeURIComponent(current)}`);
        const data = await res.json();
        if (mine !== seq.current) return;
        setSearch(
          res.ok
            ? { term: current, results: data.results as CustomerHit[], error: null }
            : {
                term: current,
                results: [],
                error: data?.error?.message ?? "Customer lookup failed.",
              },
        );
      } catch {
        if (mine !== seq.current) return;
        setSearch({ term: current, results: [], error: "Customer lookup failed." });
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [term, open]);

  const settled = search.term === q;
  const hits = settled ? search.results : [];
  const searchError = settled ? search.error : null;
  const searching = q.length > 0 && !settled;
  const searched = settled && q.length > 0;

  async function createCustomer() {
    const name = newName.trim();
    if (name.length < 2) {
      setCreateError("Enter the customer's name.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const typed = term.trim();
      const res = await fetch("/api/v1/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // A typed search term that looks like a phone number is carried over, which is
        // what makes the server's phone-based deduplication actually bite.
        body: JSON.stringify({
          name,
          phone: /^[+0-9 ()-]+$/.test(typed) ? typed : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateError(data?.error?.message ?? "Could not add the customer.");
        return;
      }
      props.onChange(data.customer as CustomerHit);
      setOpen(false);
      setTerm("");
      setNewName("");
    } catch {
      setCreateError("Could not add the customer.");
    } finally {
      setCreating(false);
    }
  }

  if (props.customer) {
    return (
      <div className="mt-4 flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900">{props.customer.name}</p>
          {props.customer.phone && (
            <p className="truncate text-xs text-slate-500">{props.customer.phone}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => props.onChange(null)}
          className="text-xs font-medium text-slate-600 underline"
        >
          Remove
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 w-full rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
      >
        Add customer (optional)
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-lg border border-slate-200 p-3">
      <div className="flex items-center justify-between">
        <label htmlFor="customer-search" className="text-sm font-medium text-slate-700">
          Customer
        </label>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setCreateError(null);
          }}
          className="text-xs text-slate-500 underline"
        >
          Cancel
        </button>
      </div>
      <input
        id="customer-search"
        autoFocus
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Name or phone"
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />

      {searching && <p className="mt-2 text-xs text-slate-400">Searching…</p>}
      {(searchError ?? createError) && (
        <p role="alert" className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700">
          {searchError ?? createError}
        </p>
      )}

      <ul className="mt-2 divide-y divide-slate-100">
        {hits.map((hit) => (
          <li key={hit.id}>
            <button
              type="button"
              onClick={() => {
                props.onChange(hit);
                setOpen(false);
                setTerm("");
              }}
              className="w-full px-1 py-2 text-left text-sm hover:bg-slate-50"
            >
              <span className="block text-slate-900">{hit.name}</span>
              {hit.phone && <span className="block text-xs text-slate-500">{hit.phone}</span>}
            </button>
          </li>
        ))}
      </ul>

      {searched && !searching && hits.length === 0 && (
        <div className="mt-2 border-t border-slate-100 pt-2">
          <p className="text-xs text-slate-500">No match. Add a new customer:</p>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Customer name"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={createCustomer}
            disabled={creating}
            className="mt-2 w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {creating ? "Adding…" : "Add customer"}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Post-sale confirmation.
 *
 * States what actually happened and nothing more. In particular `erpSyncStatus` is shown
 * honestly: no ERPNext adapter exists yet, so the sale is recorded in AMBURAX and not yet
 * in the accounting ledger, and the screen says exactly that rather than implying a
 * posting that never occurred.
 */
function SaleSuccess(props: {
  sale: CompletedSale;
  customerName: string | null;
  onNewSale: () => void;
}) {
  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <p className="text-sm font-medium text-emerald-700">Sale complete</p>
        <p className="mt-2 text-3xl font-semibold text-slate-900">
          {formatMinor(props.sale.totalMinor)}
        </p>
        <p className="mt-1 text-sm text-slate-500">Bill {props.sale.billNumber}</p>
        {props.customerName && (
          <p className="mt-1 text-sm text-slate-500">for {props.customerName}</p>
        )}

        {/*
          A retried submission returns the original sale rather than creating a second one.
          Saying so is what stops an operator concluding they charged the customer twice.
        */}
        {props.sale.duplicate && (
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            This sale was already completed — showing the original bill. The customer was
            charged once.
          </p>
        )}

        {props.sale.erpSyncStatus !== "SYNCED" && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Recorded in AMBURAX. Not yet posted to accounting.
          </p>
        )}

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={props.onNewSale}
            className="w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
          >
            New sale
          </button>
          <Link
            href={`/sales/${props.sale.id}`}
            className="w-full rounded-lg border border-slate-300 px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            View bill
          </Link>
        </div>
      </div>
    </div>
  );
}
