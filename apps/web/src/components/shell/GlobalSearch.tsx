"use client";

import * as React from "react";
import { Search, Package, User } from "lucide-react";
import { useRouter } from "next/navigation";

/**
 * Header search, typed in place — no popup. Results drop down under the field as you type
 * (products by name/SKU/barcode, customers by name/phone); Enter opens the full product list.
 * Ctrl/⌘+K focuses the field.
 */

type Hit = { kind: "product" | "customer"; id: string; title: string; sub: string; href: string };

export function GlobalSearch() {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<Hit[]>([]);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const [loading, setLoading] = React.useState(false);
  const query = q.trim();

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  React.useEffect(() => {
    if (query.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      const get = async (url: string) => {
        try {
          const r = await fetch(url, { signal: controller.signal });
          return r.ok ? await r.json() : null;
        } catch {
          return null;
        }
      };
      const [products, customers] = await Promise.all([
        get(`/api/v1/catalog/search?q=${encodeURIComponent(query)}`),
        get(`/api/v1/customers?q=${encodeURIComponent(query)}`),
      ]);
      if (controller.signal.aborted) return;
      const next: Hit[] = [];
      for (const p of (products?.results ?? []).slice(0, 5)) {
        next.push({
          kind: "product",
          id: p.variantId,
          title: p.productName,
          sub: [p.sku, p.size, p.colour].filter(Boolean).join(" · "),
          href: `/products?q=${encodeURIComponent(p.sku)}`,
        });
      }
      for (const c of (customers?.results ?? []).slice(0, 4)) {
        next.push({ kind: "customer", id: c.id, title: c.name, sub: c.phone ?? "", href: `/customers/${c.id}` });
      }
      setHits(next);
      setActive(-1);
      setLoading(false);
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const visible = query.length >= 2 ? hits : [];

  function go(href: string) {
    setOpen(false);
    setQ("");
    setHits([]);
    inputRef.current?.blur();
    router.push(href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && visible.length) {
      e.preventDefault();
      setActive((i) => (i + 1) % visible.length);
    } else if (e.key === "ArrowUp" && visible.length) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? visible.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && visible[active]) go(visible[active]!.href);
      else if (query) go(`/products?q=${encodeURIComponent(query)}`);
    } else if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  const showList = open && query.length >= 2;

  return (
    <div className="relative min-w-0 max-w-[420px] flex-1">
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-label="Search products and customers"
        aria-expanded={showList}
        aria-controls="global-search-results"
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `gs-hit-${active}` : undefined}
        autoComplete="off"
        placeholder="Search product, SKU, barcode, customer…"
        className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 pl-9 pr-14 text-[13px] text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-sky-400 focus:border-sky-500 focus:bg-white focus:ring-2 focus:ring-sky-100"
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] text-slate-400 md:block">
        Ctrl K
      </kbd>

      {showList && (
        <div
          id="global-search-results"
          role="listbox"
          aria-label="Search results"
          className="amb-fade-in absolute inset-x-0 top-full z-50 mt-1 max-h-96 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
        >
          {visible.length === 0 ? (
            <p className="px-3 py-3 text-[13px] text-slate-500">
              {loading ? "Searching…" : `Nothing found for “${query}”. Press Enter to search all products.`}
            </p>
          ) : (
            visible.map((h, i) => (
              <div
                key={`${h.kind}-${h.id}`}
                id={`gs-hit-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault();
                  go(h.href);
                }}
                onMouseEnter={() => setActive(i)}
                className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-3 py-2 ${i === active ? "bg-sky-50" : "hover:bg-slate-50"}`}
              >
                {h.kind === "product" ? (
                  <Package aria-hidden="true" className="size-4 shrink-0 text-slate-400" />
                ) : (
                  <User aria-hidden="true" className="size-4 shrink-0 text-slate-400" />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-slate-900">{h.title}</span>
                  {h.sub && <span className="block truncate text-[11px] text-slate-500">{h.sub}</span>}
                </span>
                <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {h.kind === "product" ? "Product" : "Customer"}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
