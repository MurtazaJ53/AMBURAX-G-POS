"use client";

import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
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
    if (newView !== "table") p.set("view", newView);

    router.push(`/inventory?${p.toString()}`);
  };

  return (
    <div className="mt-6 flex flex-wrap items-center gap-2 xl:flex-nowrap">
      <div className="relative min-w-0 flex-1 md:max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-secondary" />
        <input
          type="text"
          defaultValue={search}
          placeholder="Search by product name, SKU..."
          className="block w-full rounded-md border-0 py-2 pl-9 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-primary sm:text-xs"
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
        className="block w-32 rounded-md border-0 py-2 pl-3 pr-8 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-primary sm:text-xs"
        value={category || ""}
        onChange={(e) => apply({ category: e.target.value })}
      >
        <option value="">All Categories</option>
        {/* We would dynamically populate this based on facets, but for now we rely on user input or a predefined list if we had one. 
            AMBURAX F4 does dynamic facets, but F5 reference doesn't define standard lists, so we just leave it generic. 
            Let's add a few common ones for UI richness, or leave it empty so they see it filters. */}
        <option value="Men's Wear">Men&apos;s Wear</option>
        <option value="Women's Wear">Women&apos;s Wear</option>
        <option value="Accessories">Accessories</option>
        <option value="Footwear">Footwear</option>
      </select>
      
      <select 
        className="block w-32 rounded-md border-0 py-2 pl-3 pr-8 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-primary sm:text-xs"
        value={brand || ""}
        onChange={(e) => apply({ brand: e.target.value })}
      >
        <option value="">All Brands</option>
        <option value="Nike">Nike</option>
        <option value="Adidas">Adidas</option>
        <option value="Puma">Puma</option>
      </select>
      
      <select 
        className="block w-32 rounded-md border-0 py-2 pl-3 pr-8 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-primary sm:text-xs"
        value={status || ""}
        onChange={(e) => apply({ status: e.target.value })}
      >
        <option value="">All Status</option>
        <option value="in_stock">In Stock</option>
        <option value="low_stock">Low Stock</option>
        <option value="out_of_stock">Out of Stock</option>
      </select>
      
      {(search || status || category || brand) && (
        <Link href={`/inventory${view !== "table" ? `?view=${view}` : ""}`} className="inline-flex h-9 items-center justify-center rounded-md px-3 text-xs font-semibold text-primary hover:bg-slate-100">
          Reset
        </Link>
      )}
    </div>
  );
}
