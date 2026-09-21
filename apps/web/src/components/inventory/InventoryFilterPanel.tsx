"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CatalogFacets } from "@/server/catalog/catalogQueries";

interface InventoryFilterPanelProps {
  search?: string;
  status?: string;
  category?: string;
  brand?: string;
  view?: string;
  facets: CatalogFacets;
  onNavigate?: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border p-4 last:border-0">
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-primary">
        {title}
      </h3>
      {children}
    </div>
  );
}

function CheckRow({
  label,
  count,
  checked,
  onChange,
}: {
  label: string;
  count?: number;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="group flex cursor-pointer items-center justify-between gap-3 text-xs hover:text-primary">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={onChange}
          className="h-3.5 w-3.5 rounded-sm border-border text-primary focus:ring-primary focus:ring-offset-0"
        />
        <span className={cn("truncate", checked ? "font-medium text-primary" : "text-secondary")}>
          {label}
        </span>
      </div>
      {count !== undefined && (
        <span className="text-[10px] text-tertiary tabular-nums group-hover:text-secondary">
          {count}
        </span>
      )}
    </label>
  );
}

export function InventoryFilterPanel({
  search,
  status,
  category,
  brand,
  view,
  facets,
  onNavigate,
}: InventoryFilterPanelProps) {
  const router = useRouter();
  const [searchDraft, setSearchDraft] = React.useState(search || "");
  const [showAllBrands, setShowAllBrands] = React.useState(false);

  const visibleBrands = showAllBrands ? facets.brands : facets.brands.slice(0, 5);

  const apply = (updates: { q?: string; status?: string; category?: string; brand?: string }) => {
    const p = new URLSearchParams();
    
    const newSearch = updates.q !== undefined ? updates.q : search;
    const newStatus = updates.status !== undefined ? updates.status : status;
    const newCat = updates.category !== undefined ? updates.category : category;
    const newBrand = updates.brand !== undefined ? updates.brand : brand;

    if (newSearch) p.set("q", newSearch);
    if (newStatus) p.set("status", newStatus);
    if (newCat) p.set("category", newCat);
    if (newBrand) p.set("brand", newBrand);
    if (view && view !== "table") p.set("view", view);

    router.push(`/inventory?${p.toString()}`);
    if (onNavigate) onNavigate();
  };

  const toggleFilter = (current: string | undefined, value: string) => {
    return current === value ? undefined : value;
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-4">
        <h2 className="text-sm font-bold text-primary">Filters</h2>
        <div className="mt-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              apply({ q: searchDraft || undefined });
            }}
            className="flex items-center gap-2 rounded-md border border-border bg-background-app px-2 py-1.5 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary"
          >
            <Search aria-hidden="true" className="h-3 w-3 shrink-0 text-tertiary" />
            <input
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              placeholder="Search by SKU or name..."
              className="min-w-0 flex-1 bg-transparent text-xs text-secondary outline-none placeholder:text-tertiary"
            />
          </form>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <Section title="Stock status">
          <div className="space-y-1.5">
            {[
              { id: "in_stock", label: "In Stock" },
              { id: "low_stock", label: "Low Stock" },
              { id: "out_of_stock", label: "Out of Stock" }
            ].map((st) => (
              <CheckRow
                key={st.id}
                label={st.label}
                checked={status === st.id}
                onChange={() => apply({ status: toggleFilter(status, st.id) })}
              />
            ))}
          </div>
        </Section>

        {facets.categories.length > 0 && (
          <Section title="Category">
            <div className="space-y-1.5">
              {facets.categories.map((c) => (
                <CheckRow
                  key={c.value}
                  label={c.value}
                  count={c.count}
                  checked={category === c.value}
                  onChange={() => apply({ category: toggleFilter(category, c.value) })}
                />
              ))}
            </div>
          </Section>
        )}

        {facets.brands.length > 0 && (
          <Section title="Brand">
            <div className="space-y-1.5">
              {visibleBrands.map((b) => (
                <CheckRow
                  key={b.value}
                  label={b.value}
                  count={b.count}
                  checked={brand === b.value}
                  onChange={() => apply({ brand: toggleFilter(brand, b.value) })}
                />
              ))}
            </div>
            {facets.brands.length > 5 && (
              <button
                type="button"
                onClick={() => setShowAllBrands(!showAllBrands)}
                className="mt-2 text-xs font-medium hover:underline"
                style={{ color: "var(--color-primary)" }}
              >
                {showAllBrands ? "Show less" : `+ Show all ${facets.brands.length}`}
              </button>
            )}
          </Section>
        )}
      </div>
    </div>
  );
}
