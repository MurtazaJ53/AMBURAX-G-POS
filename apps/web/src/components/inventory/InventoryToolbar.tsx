"use client";

import { useRouter } from "next/navigation";
import { Search, SlidersHorizontal, RotateCcw, List, Grid2X2 } from "lucide-react";
import Link from "next/link";

export function InventoryToolbar({
  search,
  status,
  category,
  brand,
  view,
}: {
  search?: string;
  status?: string;
  category?: string;
  brand?: string;
  view: string;
}) {
  const router = useRouter();

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

    router.push(`/inventory?${p.toString()}`);
  };

  const reset = () => {
    const p = new URLSearchParams();
    if (view && view !== "table") p.set("view", view);
    router.push(`/inventory?${p.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 py-4 border-b border-border mb-4">
      <div className="relative min-w-full md:min-w-0 flex-1 md:max-w-[320px]">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-secondary" />
        <input
          type="text"
          defaultValue={search}
          placeholder="Search by product name, SKU..."
          className="block w-full h-8 rounded border border-border bg-background-card pl-8 pr-3 text-[13px] text-primary placeholder:text-secondary focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary shadow-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              apply({ q: e.currentTarget.value });
            }
          }}
          onBlur={(e) => apply({ q: e.currentTarget.value })}
        />
      </div>
      
      <select 
        className="block h-8 w-full md:w-36 rounded border border-border bg-background-card px-2 text-[12px] text-primary shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        value={category || ""}
        onChange={(e) => apply({ category: e.target.value })}
      >
        <option value="">All Categories</option>
        <option value="Men's Wear">Men&apos;s Wear</option>
        <option value="Women's Wear">Women&apos;s Wear</option>
        <option value="Accessories">Accessories</option>
        <option value="Footwear">Footwear</option>
      </select>
      
      <select 
        className="block h-8 w-full md:w-32 rounded border border-border bg-background-card px-2 text-[12px] text-primary shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        value={brand || ""}
        onChange={(e) => apply({ brand: e.target.value })}
      >
        <option value="">All Brands</option>
        <option value="Nike">Nike</option>
        <option value="Adidas">Adidas</option>
        <option value="Puma">Puma</option>
      </select>
      
      <select 
        className="block h-8 w-full md:w-32 rounded border border-border bg-background-card px-2 text-[12px] text-primary shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        value={status || ""}
        onChange={(e) => apply({ status: e.target.value })}
      >
        <option value="">All Status</option>
        <option value="in_stock">In Stock</option>
        <option value="low_stock">Low Stock</option>
        <option value="out_of_stock">Out of Stock</option>
      </select>
      
      <button className="hidden xl:inline-flex h-8 items-center justify-center gap-1.5 rounded border border-border bg-background-card px-3 text-[12px] font-semibold text-primary hover:bg-background-app shadow-sm transition-colors">
        <SlidersHorizontal className="h-3.5 w-3.5" />
        More Filters
      </button>

      <button className="xl:hidden inline-flex h-8 w-full md:w-auto items-center justify-center gap-1.5 rounded border border-border bg-background-card px-3 text-[12px] font-semibold text-primary hover:bg-background-app shadow-sm transition-colors">
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Filters
      </button>
      
      <button onClick={reset} className="inline-flex h-8 w-full md:w-auto items-center justify-center gap-1.5 px-3 text-[12px] font-medium text-secondary hover:text-primary transition-colors">
        <RotateCcw className="h-3.5 w-3.5" />
        Reset
      </button>

      <div className="ml-auto hidden md:inline-flex rounded border border-border bg-background-card p-0.5 shadow-sm">
        <button 
          onClick={() => apply({ view: "table" })}
          className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-[3px] px-3 text-[12px] font-medium transition-colors ${view !== "grid" ? "bg-slate-100 text-primary shadow-sm" : "text-secondary hover:text-primary"}`}
        >
          <List className="h-3.5 w-3.5" /> Table
        </button>
        <button 
          onClick={() => apply({ view: "grid" })}
          className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-[3px] px-3 text-[12px] font-medium transition-colors ${view === "grid" ? "bg-slate-100 text-primary shadow-sm" : "text-secondary hover:text-primary"}`}
        >
          <Grid2X2 className="h-3.5 w-3.5" /> Grid
        </button>
      </div>
    </div>
  );
}
