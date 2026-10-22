import Link from "next/link";
import type { InventoryFacetCount, InventoryFacetKind } from "@/server/inventory/inventoryQueries";

/**
 * Read-only Categories / Brands view: the distinct values already on this store's products, each
 * with the number of stock rows it would show. Selecting one opens the stock list with the
 * existing `category` or `brand` filter. Nothing here adds, renames, merges or deletes a value —
 * they are free text on each product.
 */

const LABEL: Record<InventoryFacetKind, { title: string; empty: string; noun: string }> = {
  category: { title: "Categories", empty: "No products in this store have a category yet.", noun: "category" },
  brand: { title: "Brands", empty: "No products in this store have a brand yet.", noun: "brand" },
};

export function InventoryFacetList({ kind, values }: { kind: InventoryFacetKind; values: InventoryFacetCount[] }) {
  const label = LABEL[kind];
  return (
    <section
      aria-label={`${label.title} in this store`}
      className="mt-4 overflow-hidden rounded-[6px] border border-border bg-background-card shadow-sm"
    >
      {values.length === 0 ? (
        <p className="p-12 text-center text-sm text-secondary">{label.empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {values.map((v) => (
            <li key={v.value}>
              <Link
                href={`/inventory?${new URLSearchParams({ [kind]: v.value }).toString()}`}
                className="flex items-center justify-between gap-4 px-4 py-2.5 text-[12px] hover:bg-slate-50"
              >
                <span className="min-w-0 truncate font-medium text-primary">{v.value}</span>
                <span className="shrink-0 font-mono text-secondary" aria-label={`${v.count} stock ${v.count === 1 ? "item" : "items"}`}>
                  {v.count}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-border bg-slate-50 px-4 py-2 text-[10px] text-tertiary">
        Read-only. Each {label.noun} comes from the product details; edit a product to change it.
      </p>
    </section>
  );
}
