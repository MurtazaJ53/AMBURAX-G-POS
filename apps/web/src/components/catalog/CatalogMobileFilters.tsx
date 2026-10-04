"use client";

import * as React from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { hasActiveFilters, type CatalogFilters } from "@/server/catalog/catalogFilters";
import type { CatalogFacets } from "@/server/catalog/catalogQueries";
import { CatalogFilterPanel } from "./CatalogFilterPanel";

/**
 * The filter rail as a drawer, below the width that can hold three panes.
 *
 * The same panel component renders in both places rather than a phone-shaped copy of it, so a
 * filter added to the catalogue appears on every device by construction. The drawer closes
 * itself on navigation, because leaving it covering the results the reader just asked for is
 * the classic mobile-filter mistake.
 */
export function CatalogMobileFilters({
  filters,
  facets,
}: {
  filters: CatalogFilters;
  facets: CatalogFacets;
}) {
  const [open, setOpen] = React.useState(false);
  const active = hasActiveFilters(filters);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded border border-border bg-background-card px-3 py-2 text-xs font-medium text-secondary hover:bg-background-hover md:hidden"
      >
        <SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5" />
        Filters
        {active && (
          <span
            aria-label="Filters are active"
            className="h-1.5 w-1.5 rounded-full"
            style={{ background: "var(--color-primary)" }}
          />
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Catalogue filters"
        >
          <div className="fixed inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="relative flex w-[320px] max-w-[88vw] flex-col bg-background-card">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close filters"
              className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded border border-border bg-background-card"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5 text-secondary" />
            </button>
            <CatalogFilterPanel
              filters={filters}
              facets={facets}
              onNavigate={() => setOpen(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}
