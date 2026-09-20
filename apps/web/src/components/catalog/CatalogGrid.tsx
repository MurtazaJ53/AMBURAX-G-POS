"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LayoutGrid, List as ListIcon, ChevronRight, ChevronLeft } from "lucide-react";
import {
  SORT_OPTIONS,
  catalogHref,
  colourSwatch,
  discountPercent,
  stockStatusLabel,
  stockStatusOf,
  withFilters,
  type CatalogFilters,
  type SortOption,
  type ViewMode,
} from "@/server/catalog/catalogFilters";
import type { ProductRow } from "@/server/catalog/catalogQueries";
import { formatMinor } from "@/server/sales/saleTotals";
import { cn } from "@/lib/utils";

/**
 * The catalogue's centre column: toolbar, then the product grid or list.
 *
 * Selection is a link, not a click handler. Opening a product puts its id in the URL, which is
 * what lets the detail panel be server-rendered from real data, and what makes a selected
 * product survive a filter change, a sort, a page turn or a reload. Clicking the open product
 * again closes the panel, matching the reference.
 *
 * The reference's favourite hearts are gone: there is no favourites model, and a heart that
 * forgets itself on reload is a worse lie than no heart.
 */

function StockPill({ quantity }: { quantity: number | null }) {
  const status = stockStatusOf(quantity);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
        status === "in" && "bg-success-subtle text-success",
        status === "out" && "bg-danger-subtle text-danger",
        status === "uncounted" && "bg-background-subtle text-tertiary",
      )}
    >
      {status !== "uncounted" && (
        <span
          aria-hidden="true"
          className={cn(
            "inline-block h-1.5 w-1.5 rounded-full",
            status === "in" ? "bg-success" : "bg-danger",
          )}
        />
      )}
      {stockStatusLabel(status, quantity)}
    </span>
  );
}

function PriceLine({ product }: { product: ProductRow }) {
  if (product.priceFromMinor === null) {
    return <span className="text-xs text-tertiary">No price set</span>;
  }

  // A product's variants can disagree on price, so the card shows the range rather than
  // picking one and implying it is the price.
  const ranged = product.priceToMinor !== null && product.priceToMinor !== product.priceFromMinor;
  const cheapest = product.variants.reduce<ProductRow["variants"][number] | null>(
    (best, variant) => (best === null || variant.priceMinor < best.priceMinor ? variant : best),
    null,
  );
  const discount = cheapest ? discountPercent(cheapest.priceMinor, cheapest.mrpMinor) : null;

  return (
    <span className="flex flex-wrap items-baseline gap-1.5 tabular-nums">
      <span className="text-sm font-bold text-primary">
        {formatMinor(product.priceFromMinor)}
        {ranged && (
          <span className="text-[10px] font-medium text-tertiary">
            {" "}
            – {formatMinor(product.priceToMinor!)}
          </span>
        )}
      </span>
      {discount !== null && cheapest?.mrpMinor != null && (
        <>
          <span className="text-[9px] text-tertiary line-through">
            {formatMinor(cheapest.mrpMinor)}
          </span>
          <span className="rounded-full bg-danger-subtle px-1.5 py-0.5 text-[9px] font-bold text-danger">
            {discount}% off
          </span>
        </>
      )}
    </span>
  );
}

function Initial({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-full w-full items-center justify-center bg-background-subtle text-lg font-semibold text-tertiary"
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function Thumb({ product, className }: { product: ProductRow; className?: string }) {
  // A URL that 404s is not the same as no URL, and the browser's broken-image glyph is the
  // one outcome worse than either: it reads as a bug in the page rather than a missing
  // photograph. Falling back to the same placeholder keeps the grid legible whatever the
  // catalogue's image hosting is doing today.
  // The *URL* that failed is remembered, not a bare boolean. A product whose picture is
  // corrected gets a new URL, which no longer matches, so it is retried without needing an
  // effect to reset a flag.
  const [failedUrl, setFailedUrl] = React.useState<string | null>(null);

  if (!product.imageUrl || failedUrl === product.imageUrl) {
    return <Initial name={product.name} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={product.imageUrl}
      alt=""
      loading="lazy"
      onError={() => setFailedUrl(product.imageUrl)}
      className={cn("h-full w-full object-cover", className)}
    />
  );
}

export function ProductCard({
  product,
  filters,
  selected,
  view,
}: {
  product: ProductRow;
  filters: CatalogFilters;
  selected: boolean;
  view: ViewMode;
}) {
  // Clicking the open product closes the panel, as in the reference.
  const href = catalogHref({ ...filters, selectedId: selected ? null : product.id });

  const sizes = [...new Set(product.variants.map((v) => v.size).filter(Boolean))] as string[];
  const colours = [...new Set(product.variants.map((v) => v.colour).filter(Boolean))] as string[];

  if (view === "list") {
    return (
      <Link
        href={href}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex items-center gap-3 rounded-md border bg-background-card p-3 transition-all hover:shadow-md",
          selected
            ? "border-[color:var(--color-primary)] ring-1 ring-[color:var(--color-primary)]"
            : "border-border",
        )}
      >
        <span className="h-12 w-12 shrink-0 overflow-hidden rounded">
          <Thumb product={product} />
        </span>
        <span className="min-w-0 flex-1">
          {!product.isActive && (
            <span className="mb-0.5 inline-block rounded-full bg-background-active px-1.5 py-0.5 text-[9px] font-bold text-secondary">
              Inactive
            </span>
          )}
          <span className="block truncate text-xs font-semibold text-primary">{product.name}</span>
          <span className="block truncate text-[10px] text-tertiary">
            {[product.variants[0]?.sku, product.brand].filter(Boolean).join(" · ") || "No variants"}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <PriceLine product={product} />
          <span className="mt-1 block">
            <StockPill quantity={product.stockQuantity} />
          </span>
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "group relative flex flex-col justify-between overflow-hidden rounded-md border bg-background-card p-2 transition-all hover:-translate-y-px hover:shadow-md",
        selected
          ? "border-[color:var(--color-primary)] ring-1 ring-[color:var(--color-primary)]"
          : "border-border",
      )}
    >
      <span className="relative block aspect-square overflow-hidden rounded-md bg-background-subtle">
        <Thumb
          product={product}
          className="transition-transform duration-300 group-hover:scale-105"
        />
        {!product.isActive && (
          <span className="absolute left-1.5 top-1.5 rounded-sm bg-background-active px-1.5 py-0.5 text-[9px] font-bold text-secondary">
            Inactive
          </span>
        )}
      </span>

      <span className="block space-y-1 pt-2">
        <span className="block truncate text-xs font-semibold leading-tight text-primary">
          {product.name}
        </span>
        <span className="mt-0.5 block truncate text-[10px] font-bold uppercase tracking-wider text-tertiary">
          {product.variants[0]?.sku ?? "No variants"}
        </span>
        <span className="block truncate text-[10px] text-secondary">
          {product.brand ?? product.category ?? "Uncategorised"}
        </span>

        <span className="mt-1.5 block">
          <PriceLine product={product} />
        </span>

        <span className="mt-1.5 block">
          <StockPill quantity={product.stockQuantity} />
        </span>

        {colours.length > 0 && (
          <span className="mt-2 flex items-center gap-1">
            {colours.slice(0, 5).map((colour) => {
              const swatch = colourSwatch(colour);
              return swatch ? (
                <span
                  key={colour}
                  title={colour}
                  className="h-3.5 w-3.5 rounded-full border border-border"
                  style={{ background: swatch }}
                />
              ) : (
                <span key={colour} className="text-[9px] text-tertiary">
                  {colour}
                </span>
              );
            })}
            {colours.length > 5 && (
              <span className="text-[9px] text-tertiary">+{colours.length - 5}</span>
            )}
          </span>
        )}

        {sizes.length > 0 && (
          <span className="mt-1.5 flex flex-wrap items-center gap-1">
            {sizes.slice(0, 6).map((size) => (
              <span
                key={size}
                className="rounded border border-border px-1 py-0.5 text-[9px] text-secondary"
              >
                {size}
              </span>
            ))}
          </span>
        )}
      </span>
    </Link>
  );
}

export function CatalogToolbar({
  filters,
  total,
  page,
  pageCount,
}: {
  filters: CatalogFilters;
  total: number;
  page: number;
  pageCount: number;
}) {
  const router = useRouter();

  // Windowed page links: first, a run around the current page, last. The reference shows
  // "1 2 3 … 56" and the ellipsis has to be real — a catalogue of 56 pages cannot print 56
  // buttons, and a catalogue of 3 must not print an ellipsis.
  const pages: (number | "gap")[] = [];
  const push = (value: number | "gap") => {
    if (value === "gap" && pages[pages.length - 1] === "gap") return;
    pages.push(value);
  };
  for (let candidate = 1; candidate <= pageCount; candidate += 1) {
    if (candidate === 1 || candidate === pageCount || Math.abs(candidate - page) <= 1) {
      push(candidate);
    } else {
      push("gap");
    }
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-background-card px-4 py-2.5">
      <span className="text-sm font-bold text-primary">
        {total.toLocaleString("en-IN")} {total === 1 ? "product" : "products"}
      </span>

      <span className="flex-1" />

      <label className="flex items-center gap-1.5 text-xs text-secondary">
        <span className="hidden sm:inline">Sort by</span>
        <select
          value={filters.sort}
          onChange={(event) =>
            router.push(
              catalogHref(withFilters(filters, { sort: event.target.value as SortOption })),
            )
          }
          aria-label="Sort products"
          className="rounded border border-border bg-background-card px-2 py-1.5 text-xs text-secondary outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div
        className="flex overflow-hidden rounded border border-border"
        role="group"
        aria-label="View mode"
      >
        {[
          { mode: "list" as const, Icon: ListIcon, label: "List view" },
          { mode: "grid" as const, Icon: LayoutGrid, label: "Grid view" },
        ].map(({ mode, Icon, label }) => {
          const active = filters.view === mode;
          return (
            <Link
              key={mode}
              // Page and selection ride along, so changing view never loses the reader's place.
              href={catalogHref({ ...filters, view: mode })}
              aria-label={label}
              aria-pressed={active}
              className={cn(
                "px-2.5 py-1.5 transition-colors",
                active ? "text-white" : "bg-background-card text-tertiary hover:text-secondary",
              )}
              style={active ? { background: "var(--color-primary)" } : undefined}
            >
              <Icon aria-hidden="true" className="h-3.5 w-3.5" />
            </Link>
          );
        })}
      </div>

      {pageCount > 1 && (
        <nav className="flex items-center gap-1" aria-label="Catalogue pages">
          {page > 1 && (
            <Link
              href={catalogHref({ ...filters, page: page - 1 })}
              aria-label="Previous page"
              className="flex h-7 w-7 items-center justify-center rounded border border-border hover:bg-background-hover"
            >
              <ChevronLeft aria-hidden="true" className="h-3 w-3 text-secondary" />
            </Link>
          )}
          {pages.map((entry, index) =>
            entry === "gap" ? (
              <span key={`gap-${index}`} className="w-7 text-center text-xs text-tertiary">
                ···
              </span>
            ) : (
              <Link
                key={entry}
                href={catalogHref({ ...filters, page: entry })}
                aria-current={entry === page ? "page" : undefined}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded text-xs font-medium transition-colors",
                  entry === page ? "text-white" : "text-secondary hover:bg-background-hover",
                )}
                style={entry === page ? { background: "var(--color-primary)" } : undefined}
              >
                {entry}
              </Link>
            ),
          )}
          {page < pageCount && (
            <Link
              href={catalogHref({ ...filters, page: page + 1 })}
              aria-label="Next page"
              className="flex h-7 w-7 items-center justify-center rounded border border-border hover:bg-background-hover"
            >
              <ChevronRight aria-hidden="true" className="h-3 w-3 text-secondary" />
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}

export function ProductGrid({
  products,
  filters,
  panelOpen,
}: {
  products: ProductRow[];
  filters: CatalogFilters;
  /** The open panel takes a column, so the grid loosens to keep cards readable. */
  panelOpen: boolean;
}) {
  if (filters.view === "list") {
    return (
      <div className="flex max-w-3xl flex-col gap-2">
        {products.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            filters={filters}
            selected={filters.selectedId === product.id}
            view="list"
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className="grid gap-2.5"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(154px, 1fr))" }}
    >
      {products.map((product) => (
        <ProductCard
          key={product.id}
          product={product}
          filters={filters}
          selected={filters.selectedId === product.id}
          view="grid"
        />
      ))}
    </div>
  );
}
