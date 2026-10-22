"use client";

import * as React from "react";
import { Package, Search, X } from "lucide-react";

/** One sellable variant as the till's catalogue search returns it (the fields this picker uses). */
export interface PickedVariant {
  variantId: string;
  productName: string;
  sku: string;
  size: string | null;
  colour: string | null;
  /** Units in the signed-in store; null when the variant has no stock row here yet. */
  stockQuantity: number | null;
}

const label = (v: PickedVariant) =>
  `${v.productName}${[v.size, v.colour].filter(Boolean).length ? ` (${[v.size, v.colour].filter(Boolean).join(" / ")})` : ""}`;

/**
 * Search-as-you-type variant picker for back-office stock forms. Replaces a <select> that loaded
 * every variant: a store with tens of thousands made the page slow and the list unusable. Queries
 * the till's catalogue endpoint (tenant and store come from the session), 2+ characters, debounced.
 * Submits the chosen id through a hidden input named `name`, so form handlers read it unchanged.
 */
export function VariantSearchPicker(props: {
  id: string;
  name: string;
  onChange?: (variant: PickedVariant | null) => void;
  required?: boolean;
}) {
  const [term, setTerm] = React.useState("");
  const [results, setResults] = React.useState<PickedVariant[]>([]);
  const [status, setStatus] = React.useState<"idle" | "loading" | "error">("idle");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const [picked, setPicked] = React.useState<PickedVariant | null>(null);
  const seq = React.useRef(0);
  const listId = `${props.id}-list`;

  React.useEffect(() => {
    const q = term.trim();
    if (picked || q.length < 2) return;
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      setStatus("loading");
      try {
        const res = await fetch(`/api/v1/catalog/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (mine !== seq.current) return;
        setResults(res.ok ? (data.results as PickedVariant[]) : []);
        setStatus(res.ok ? "idle" : "error");
        setActive(-1);
        setOpen(true);
      } catch {
        if (mine === seq.current) setStatus("error");
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [term, picked]);

  const choose = (v: PickedVariant) => {
    setPicked(v);
    setOpen(false);
    setTerm("");
    props.onChange?.(v);
  };
  const clear = () => {
    setPicked(null);
    setResults([]);
    props.onChange?.(null);
  };

  if (picked) {
    return (
      <div className="amb-pop-in mt-1 flex min-h-11 items-center justify-between gap-3 rounded-lg border border-slate-300 bg-white px-3 py-2">
        <input type="hidden" name={props.name} value={picked.variantId} />
        <span className="flex min-w-0 items-center gap-2 text-sm">
          <Package aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500" />
          <span className="truncate font-medium text-slate-900">{label(picked)}</span>
          <span className="shrink-0 text-slate-500">{picked.sku}</span>
        </span>
        <button
          type="button"
          onClick={clear}
          aria-label={`Change product (${label(picked)} selected)`}
          className="amb-focus inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    );
  }

  const q = term.trim();
  return (
    <div className="relative mt-1">
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
      <input
        id={props.id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        required={props.required}
        autoComplete="off"
        value={term}
        placeholder="Type a product name or SKU…"
        onChange={(e) => {
          setTerm(e.target.value);
          if (e.target.value.trim().length < 2) {
            setOpen(false);
            setResults([]);
          }
        }}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(results.length - 1, i + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (e.key === "Enter" && open && active >= 0 && results[active]) {
            e.preventDefault();
            choose(results[active]!);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className="amb-focus block min-h-11 w-full rounded-lg border border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-900 placeholder:text-slate-500"
      />
      <p className="sr-only" role="status" aria-live="polite">
        {status === "loading" ? "Searching" : open ? `${results.length} results` : ""}
      </p>
      {open && q.length >= 2 && (
        <ul
          id={listId}
          role="listbox"
          className="amb-pop-in absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-slate-600">{status === "error" ? "Search failed. Try again." : "No matching products."}</li>
          ) : (
            results.map((v, i) => (
              <li
                key={v.variantId}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(v);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm ${i === active ? "bg-sky-50" : ""}`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-900">{label(v)}</span>
                  <span className="block text-xs text-slate-500">{v.sku}</span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-slate-600">{v.stockQuantity ?? 0} in stock</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
