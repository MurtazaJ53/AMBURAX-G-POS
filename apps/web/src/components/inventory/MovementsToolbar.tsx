"use client";

import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import Link from "next/link";

export function MovementsToolbar({
  search,
  type,
}: {
  search?: string;
  type?: string;
}) {
  const router = useRouter();

  const apply = (updates: { q?: string; type?: string }) => {
    const p = new URLSearchParams();
    
    const newSearch = updates.q !== undefined ? updates.q : search;
    const newType = updates.type !== undefined ? updates.type : type;

    if (newSearch) p.set("q", newSearch);
    if (newType) p.set("type", newType);

    router.push(`/inventory/movements?${p.toString()}`);
  };

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 xl:flex-nowrap">
      <div className="relative min-w-0 flex-1 md:max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-secondary" />
        <input
          type="text"
          defaultValue={search}
          placeholder="Search by product name, SKU..."
          className="block w-full rounded-md border-0 py-2 pl-9 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 placeholder:text-slate-500 focus:ring-2 focus:ring-inset focus:ring-primary sm:text-xs"
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
        className="block w-40 rounded-md border-0 py-2 pl-3 pr-8 text-slate-900 shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-inset focus:ring-primary sm:text-xs"
        value={type || ""}
        onChange={(e) => apply({ type: e.target.value })}
      >
        <option value="">All Movement Types</option>
        <option value="RECEIPT">Receipt</option>
        <option value="SALE">Sale</option>
        <option value="ADJUSTMENT">Adjustment</option>
        <option value="STOCK_TAKE">Stock Take</option>
        <option value="SUPPLIER_RETURN">Return to supplier</option>
        <option value="TRANSFER_OUT">Transfer out</option>
        <option value="TRANSFER_IN">Transfer in</option>
        <option value="OPENING_BALANCE">Opening Balance</option>
      </select>
      
      {(search || type) && (
        <Link href="/inventory/movements" className="inline-flex h-9 items-center justify-center rounded-md px-3 text-xs font-semibold text-primary hover:bg-slate-100">
          Reset
        </Link>
      )}
    </div>
  );
}
