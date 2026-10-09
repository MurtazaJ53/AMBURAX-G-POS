"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, SlidersHorizontal, RotateCcw, List, Grid2X2 } from "lucide-react";
import Link from "next/link";

export function InventoryToolbar({
  search,
  status,
  category,
  brand,
  view,
  page,
  categories,
  brands,
}: {
  search?: string;
  status?: string;
  category?: string;
  brand?: string;
  view: string;
  page: number;
  categories: string[];
  brands: string[];
}) {
  const router = useRouter();
  
  const [query, setQuery] = useState(search || "");
  const [prevSearch, setPrevSearch] = useState(search);

  if (search !== prevSearch) {
    setPrevSearch(search);
    setQuery(search || "");
  }

  // Pending state for the live search below, so a filter in flight is visible rather than
  // looking like nothing happened.
  const [isPending, startTransition] = useTransition();

  const apply = (updates: { q?: string; status?: string; category?: string; brand?: string; view?: string }) => {
    const p = new URLSearchParams();
    
    const newSearch = updates.q !== undefined ? updates.q : search;
    const newStatus = updates.status !== undefined ? updates.status : status;
    const newCat = updates.category !== undefined ? updates.category : category;
    const newBrand = updates.brand !== undefined ? updates.brand : brand;
    const newView = updates.view !== undefined ? updates.view : view;

    if (newSearch) p.set("q", newSearch);
    if (newStatus) p.set("status", newStatus);
    if (newCat) p.set("category", newCat);
    if (newBrand) p.set("brand", newBrand);
    if (newView && newView !== "table") p.set("view", newView);
    // Switching between table and grid shows the same rows, so it keeps the page; a new search
    // or filter changes the result set and starts again from page 1.
    if (updates.view !== undefined && page > 1) p.set("page", String(page));

    router.push(`/inventory?${p.toString()}`);
  };

  const reset = () => {
    const p = new URLSearchParams();
    if (view && view !== "table") p.set("view", view);
    router.push(`/inventory?${p.toString()}`);
  };

  /*
    Live search, 350ms — the same debounce the sales screen already uses, so every search box
    in the product behaves the same way. This one previously did nothing until Enter.

    `query` is re-synced from the `search` prop during render (Reset, Back, Forward), so the
    comparison below is what stops the effect re-pushing the query it just navigated to.
    Enter still submits immediately; the pending timer is cleared on unmount.
  */
  useEffect(() => {
    const next = query.trim();
    if (next === (search ?? "")) return;
    const t = window.setTimeout(() => {
      startTransition(() => {
        const p = new URLSearchParams();
        if (next) p.set("q", next);
        if (status) p.set("status", status);
        if (category) p.set("category", category);
        if (brand) p.set("brand", brand);
        if (view && view !== "table") p.set("view", view);
        router.push(`/inventory?${p.toString()}`);
      });
    }, 350);
    return () => window.clearTimeout(t);
  }, [query, search, status, category, brand, view, router]);

  return (
    <div className="flex flex-wrap items-center gap-2 py-4 border-b border-border mb-4">
      <form 
        onSubmit={(e) => {
          e.preventDefault();
          apply({ q: query });
        }}
        className="relative min-w-full md:min-w-0 flex-1 md:max-w-[320px]"
      >
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-secondary" />
        <input
          name="q"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by product name, SKU..."
          className="block w-full h-8 rounded border border-border bg-background-card pl-8 pr-3 text-[13px] text-primary placeholder:text-secondary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary shadow-sm"
          aria-label="Search inventory"
        />
        {/* Absolutely positioned, so showing it never resizes the field. */}
        {isPending && (
          <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
            <span className="block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
          </span>
        )}
        <span className="sr-only" role="status" aria-live="polite">
          {isPending ? "Updating inventory results" : ""}
        </span>
        <button type="submit" className="sr-only">Search</button>
      </form>
      
      <select 
        className="block h-8 w-full md:w-36 rounded border border-border bg-background-card px-2 text-[12px] text-primary shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        value={category || ""}
        onChange={(e) => apply({ category: e.target.value })}
        aria-label="Filter by category"
      >
        <option value="">All Categories</option>
        {categories.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      
      <select 
        className="block h-8 w-full md:w-32 rounded border border-border bg-background-card px-2 text-[12px] text-primary shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        value={brand || ""}
        onChange={(e) => apply({ brand: e.target.value })}
        aria-label="Filter by brand"
      >
        <option value="">All Brands</option>
        {brands.map((b) => <option key={b} value={b}>{b}</option>)}
      </select>
      
      <select 
        className="block h-8 w-full md:w-32 rounded border border-border bg-background-card px-2 text-[12px] text-primary shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        value={status || ""}
        onChange={(e) => apply({ status: e.target.value })}
        aria-label="Filter by status"
      >
        <option value="">All Status</option>
        <option value="in_stock">In Stock</option>
        <option value="low_stock">Low Stock</option>
        <option value="out_of_stock">Out of Stock</option>
      </select>
      
      <button onClick={reset} className="inline-flex h-8 w-full md:w-auto items-center justify-center gap-1.5 px-3 text-[12px] font-medium text-secondary hover:text-primary transition-colors">
        <RotateCcw className="h-3.5 w-3.5" />
        Reset
      </button>

      <div className="ml-auto inline-flex rounded border border-border bg-background-card p-0.5 shadow-sm" role="group" aria-label="Inventory view">
        <button 
          onClick={() => apply({ view: "table" })}
          className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-[3px] px-3 text-[12px] font-medium transition-colors ${view !== "grid" ? "bg-slate-100 text-primary shadow-sm" : "text-secondary hover:text-primary"}`}
          aria-pressed={view !== "grid"}
        >
          <List className="h-3.5 w-3.5" /> Table
        </button>
        <button 
          onClick={() => apply({ view: "grid" })}
          className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-[3px] px-3 text-[12px] font-medium transition-colors ${view === "grid" ? "bg-slate-100 text-primary shadow-sm" : "text-secondary hover:text-primary"}`}
          aria-pressed={view === "grid"}
        >
          <Grid2X2 className="h-3.5 w-3.5" /> Grid
        </button>
      </div>
    </div>
  );
}
