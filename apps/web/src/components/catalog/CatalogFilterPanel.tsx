"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Search } from "lucide-react";
import {
  STOCK_STATUSES,
  catalogHref,
  colourSwatch,
  hasActiveFilters,
  toggleValue,
  withFilters,
  type CatalogFilters,
  type StockStatus,
} from "@/server/catalog/catalogFilters";
import type { CatalogFacets } from "@/server/catalog/catalogQueries";
import { cn } from "@/lib/utils";

/**
 * The catalogue filter rail.
 *
 * Every control writes to the URL rather than to local state, so a filtered catalogue is a
 * link, the back button undoes a filter, and switching grid to list cannot lose anything. The
 * panel holds exactly one piece of its own state — which sections are collapsed — because that
 * is a preference about this screen rather than a description of the results.
 *
 * Two of the reference's filters are absent, and their absence is the point. "Low stock" needs
 * a reorder level no column provides, and the Tags panel (New Arrival / Best Seller / On
 * Offer) needs a tagging model, a sales ranking and an offers engine that do not exist.
 * Rendering either would ship a control that silently filters on a number this product
 * invented.
 */

export interface CatalogFilterPanelProps {
  filters: CatalogFilters;
  facets: CatalogFacets;
  /** Mobile renders this inside a drawer, which needs a way to close itself. */
  onNavigate?: () => void;
}

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="border-b border-border py-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="mb-2 flex w-full items-center justify-between text-xs font-semibold uppercase tracking-wide text-secondary"
      >
        {title}
        <ChevronDown
          aria-hidden="true"
          className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && children}
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
    <label className="group flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="h-3.5 w-3.5 rounded border-border accent-[color:var(--color-primary)]"
      />
      <span className="flex-1 truncate text-xs text-secondary group-hover:text-primary">
        {label}
      </span>
      {count !== undefined && <span className="text-[10px] text-tertiary">({count})</span>}
    </label>
  );
}

export function CatalogFilterPanel({ filters, facets, onNavigate }: CatalogFilterPanelProps) {
  const router = useRouter();
  const [showAllBrands, setShowAllBrands] = React.useState(false);
  const [searchDraft, setSearchDraft] = React.useState(filters.query);
  const [syncedQuery, setSyncedQuery] = React.useState(filters.query);

  // The URL is the source of truth, so a back/forward navigation must win over whatever is
  // currently typed in the box. Adjusted during render rather than in an effect: an effect
  // would render once with the stale draft and then again with the new one, and React's own
  // guidance is to reconcile a prop-derived value here instead.
  if (syncedQuery !== filters.query) {
    setSyncedQuery(filters.query);
    setSearchDraft(filters.query);
  }

  const apply = React.useCallback(
    (changes: Partial<CatalogFilters>) => {
      router.push(catalogHref(withFilters(filters, changes)));
      onNavigate?.();
    },
    [filters, router, onNavigate],
  );

  const visibleBrands = showAllBrands ? facets.brands : facets.brands.slice(0, 5);
  const stockCounts: Record<StockStatus, number> = {
    in: facets.stock.in,
    out: facets.stock.out,
    uncounted: facets.stock.uncounted,
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="text-sm font-semibold text-primary">Filters</span>
        {hasActiveFilters(filters) && (
          <button
            type="button"
            onClick={() =>
              apply({
                query: "",
                categories: [],
                brands: [],
                sizes: [],
                colours: [],
                priceMinMinor: null,
                priceMaxMinor: null,
                stock: [],
              })
            }
            className="text-xs font-medium hover:underline"
            style={{ color: "var(--color-primary)" }}
          >
            Clear all
          </button>
        )}
      </div>

      <div className="px-4">
        <div className="border-b border-border py-3">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              apply({ query: searchDraft.trim() });
            }}
            className="flex items-center gap-2 rounded border border-border bg-background-subtle px-2.5 py-1.5"
          >
            <Search aria-hidden="true" className="h-3 w-3 shrink-0 text-tertiary" />
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Search within results..."
              aria-label="Search within results"
              className="min-w-0 flex-1 bg-transparent text-xs text-secondary outline-none placeholder:text-tertiary"
            />
          </form>
        </div>

        {facets.categories.length > 0 && (
          <Section title="Category">
            <div className="space-y-1.5">
              {facets.categories.map((category) => (
                <CheckRow
                  key={category.value}
                  label={category.value}
                  count={category.count}
                  checked={filters.categories.includes(category.value)}
                  onChange={() =>
                    apply({ categories: toggleValue(filters.categories, category.value) })
                  }
                />
              ))}
            </div>
          </Section>
        )}

        {facets.brands.length > 0 && (
          <Section title="Brand">
            <div className="space-y-1.5">
              {visibleBrands.map((brand) => (
                <CheckRow
                  key={brand.value}
                  label={brand.value}
                  count={brand.count}
                  checked={filters.brands.includes(brand.value)}
                  onChange={() => apply({ brands: toggleValue(filters.brands, brand.value) })}
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

        <Section title="Price range">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const read = (key: string) => {
                const raw = String(data.get(key) ?? "").trim();
                if (raw === "") return null;
                const value = Number(raw);
                return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
              };
              apply({ priceMinMinor: read("min"), priceMaxMinor: read("max") });
            }}
            className="flex items-center gap-2"
          >
            {(["min", "max"] as const).map((bound) => (
              <React.Fragment key={bound}>
                {bound === "max" && <span className="text-xs text-tertiary">to</span>}
                <span className="flex flex-1 items-center gap-1 rounded border border-border px-2 py-1.5 text-xs text-secondary">
                  <span className="text-tertiary">₹</span>
                  <input
                    name={bound}
                    type="number"
                    min={0}
                    inputMode="numeric"
                    aria-label={bound === "min" ? "Minimum price" : "Maximum price"}
                    defaultValue={
                      bound === "min"
                        ? filters.priceMinMinor !== null
                          ? filters.priceMinMinor / 100
                          : ""
                        : filters.priceMaxMinor !== null
                          ? filters.priceMaxMinor / 100
                          : ""
                    }
                    className="w-full min-w-0 bg-transparent outline-none"
                  />
                </span>
              </React.Fragment>
            ))}
            <button
              type="submit"
              className="rounded border border-border px-2 py-1.5 text-xs font-medium text-secondary hover:bg-background-hover"
            >
              Go
            </button>
          </form>
        </Section>

        {facets.sizes.length > 0 && (
          <Section title="Size">
            <div className="grid grid-cols-3 gap-1.5">
              {facets.sizes.map((size) => {
                const active = filters.sizes.includes(size);
                return (
                  <button
                    key={size}
                    type="button"
                    aria-pressed={active}
                    onClick={() => apply({ sizes: toggleValue(filters.sizes, size) })}
                    className={cn(
                      "rounded border px-2.5 py-1 text-xs font-medium transition-colors",
                      active
                        ? "border-transparent text-white"
                        : "border-border bg-background-card text-secondary hover:border-border-hover",
                    )}
                    style={active ? { background: "var(--color-primary)" } : undefined}
                  >
                    {size}
                  </button>
                );
              })}
            </div>
          </Section>
        )}

        {facets.colours.length > 0 && (
          <Section title="Colour">
            <div className="flex flex-wrap items-center gap-2">
              {facets.colours.map((colour) => {
                const swatch = colourSwatch(colour);
                const active = filters.colours.includes(colour);
                // A colour we cannot render honestly becomes a text chip rather than a swatch
                // filled with a guess.
                return swatch ? (
                  <button
                    key={colour}
                    type="button"
                    title={colour}
                    aria-label={colour}
                    aria-pressed={active}
                    onClick={() => apply({ colours: toggleValue(filters.colours, colour) })}
                    className={cn(
                      "h-6 w-6 rounded-full border-2 transition-all",
                      active ? "scale-110 border-[color:var(--color-primary)]" : "border-border",
                    )}
                    style={{ background: swatch }}
                  />
                ) : (
                  <button
                    key={colour}
                    type="button"
                    aria-pressed={active}
                    onClick={() => apply({ colours: toggleValue(filters.colours, colour) })}
                    className={cn(
                      "rounded border px-2 py-1 text-[11px] font-medium",
                      active
                        ? "border-transparent text-white"
                        : "border-border text-secondary hover:border-border-hover",
                    )}
                    style={active ? { background: "var(--color-primary)" } : undefined}
                  >
                    {colour}
                  </button>
                );
              })}
            </div>
          </Section>
        )}

        <Section title="Stock status">
          <div className="space-y-1.5">
            {STOCK_STATUSES.map((status) => (
              <CheckRow
                key={status.id}
                label={status.label}
                count={stockCounts[status.id]}
                checked={filters.stock.includes(status.id)}
                onChange={() =>
                  apply({ stock: toggleValue(filters.stock, status.id) as StockStatus[] })
                }
              />
            ))}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-tertiary">
            Counts are for this store. AMBURAX has no reorder levels, so it cannot offer a
            &quot;low stock&quot; filter.
          </p>
        </Section>
      </div>
    </div>
  );
}
