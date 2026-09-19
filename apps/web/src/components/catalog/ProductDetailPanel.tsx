"use client";

import * as React from "react";
import Link from "next/link";
import { Boxes, Pencil, Plus, X } from "lucide-react";
import {
  catalogHref,
  colourSwatch,
  discountPercent,
  stockStatusLabel,
  stockStatusOf,
  type CatalogFilters,
} from "@/server/catalog/catalogFilters";
import type { ProductDetail } from "@/server/catalog/catalogQueries";
import { formatMinor } from "@/server/sales/saleTotals";
import { cn } from "@/lib/utils";

/**
 * The right-hand product panel.
 *
 * Five tabs, each bound to the domain that owns its facts: the catalogue for details and
 * pricing, inventory for stock (per store, ADR-080 — an operational count, never a ledger),
 * and sales for what actually sold. Where a domain has nothing to say, the tab says so rather
 * than filling the space.
 *
 * Three things the reference shows are deliberately not here:
 *
 * The image gallery. `Product.imageUrl` is one nullable URL, and a filmstrip of thumbnails
 * would need an image table that does not exist. The panel shows the one real picture and the
 * Images tab explains the limit instead of inventing media records.
 *
 * "~38% margin". Margin needs a cost price; no variant carries one. Discount against MRP
 * survives, because both of its inputs are real columns.
 *
 * Duplicate, Add to Offer and View in ERPNext. No duplicate endpoint, no offers engine, no
 * ERPNext adapter — a button that does nothing is worse than an absent one.
 */

type DetailTab = "stock" | "pricing" | "details" | "images" | "sales";

const TABS: { id: DetailTab; label: string }[] = [
  { id: "stock", label: "Stock" },
  { id: "pricing", label: "Pricing" },
  { id: "details", label: "Details" },
  { id: "images", label: "Images" },
  { id: "sales", label: "Sales" },
];

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-tertiary">{label}</span>
      <span className="text-right text-xs font-medium text-primary">{value}</span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-xs text-tertiary">{children}</p>;
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeZone: "Asia/Kolkata",
});

export interface ProductDetailPanelProps {
  detail: ProductDetail;
  filters: CatalogFilters;
  canManage: boolean;
}

export function ProductDetailPanel({ detail, filters, canManage }: ProductDetailPanelProps) {
  const [tab, setTab] = React.useState<DetailTab>("stock");
  // Same reasoning as the grid's thumbnail: a URL that fails to load falls back to the
  // placeholder rather than the browser's broken-image glyph. The failed URL is remembered
  // rather than a bare flag, so a corrected picture is retried without an effect to reset it.
  const [failedUrl, setFailedUrl] = React.useState<string | null>(null);
  const { product } = detail;

  const showImage = Boolean(product.imageUrl) && failedUrl !== product.imageUrl;

  const cheapest = product.variants.reduce<(typeof product.variants)[number] | null>(
    (best, variant) => (best === null || variant.priceMinor < best.priceMinor ? variant : best),
    null,
  );
  const discount = cheapest ? discountPercent(cheapest.priceMinor, cheapest.mrpMinor) : null;

  const colours = [...new Set(product.variants.map((v) => v.colour).filter(Boolean))] as string[];
  const sizes = [...new Set(product.variants.map((v) => v.size).filter(Boolean))] as string[];
  const totalCounted = detail.storeStock.reduce((sum, row) => sum + row.quantity, 0);

  return (
    <aside
      aria-label={`${product.name} details`}
      className="flex w-full shrink-0 flex-col overflow-y-auto border-l border-border bg-background-card xl:w-96"
    >
      <div className="relative border-b border-border bg-background-subtle p-3">
        <div className="mx-auto aspect-[4/5] w-40 overflow-hidden rounded-xl bg-background-card">
          {showImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.imageUrl!}
              alt={product.name}
              onError={() => setFailedUrl(product.imageUrl)}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-3xl font-semibold text-tertiary">
              {product.name.trim().charAt(0).toUpperCase() || "?"}
            </span>
          )}
        </div>

        <div className="absolute right-3 top-3 flex items-center gap-1">
          {canManage && (
            <Link
              href={`/products/${product.id}/edit`}
              className="flex items-center gap-1 rounded-lg border bg-background-card px-2 py-1 text-xs font-medium"
              style={{ color: "var(--color-primary)", borderColor: "var(--color-primary-subtle)" }}
            >
              <Pencil aria-hidden="true" className="h-3 w-3" />
              Edit
            </Link>
          )}
          <Link
            href={catalogHref({ ...filters, selectedId: null })}
            aria-label="Close product details"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-background-card hover:bg-background-hover"
          >
            <X aria-hidden="true" className="h-3.5 w-3.5 text-secondary" />
          </Link>
        </div>
      </div>

      <div className="border-b border-border px-4 pb-2 pt-3">
        <div className="mb-1 flex items-center gap-2">
          <h2 className="text-sm font-bold text-primary">{product.name}</h2>
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
              product.isActive
                ? "bg-success-subtle text-success"
                : "bg-background-active text-secondary",
            )}
          >
            {product.isActive ? "Active" : "Inactive"}
          </span>
        </div>
        <p className="mb-1 text-xs text-tertiary">
          {[product.variants[0]?.sku, product.brand].filter(Boolean).join(" | ") || "No variants"}
        </p>
        {product.category && (
          <Link
            href={catalogHref({ ...filters, categories: [product.category], page: 1 })}
            className="text-[10px] hover:underline"
            style={{ color: "var(--color-primary)" }}
          >
            {product.category}
          </Link>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {product.priceFromMinor === null ? (
            <span className="text-xs text-tertiary">No price set</span>
          ) : (
            <>
              <span className="text-lg font-extrabold text-primary">
                {formatMinor(product.priceFromMinor)}
              </span>
              {cheapest?.mrpMinor != null && discount !== null && (
                <>
                  <span className="text-xs text-tertiary line-through">
                    MRP {formatMinor(cheapest.mrpMinor)}
                  </span>
                  <span className="rounded-full bg-danger-subtle px-1.5 py-0.5 text-xs font-bold text-danger">
                    {discount}% OFF
                  </span>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <div className="border-b border-border px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          {/* The real count, not the reference's fixed "Variants (12)". */}
          <span className="text-xs font-semibold text-primary">
            Variants ({product.variantCount})
          </span>
          <Link
            href={`/products/${product.id}`}
            className="text-xs font-medium hover:underline"
            style={{ color: "var(--color-primary)" }}
          >
            View all
          </Link>
        </div>

        {product.variantCount === 0 ? (
          <p className="text-xs text-tertiary">
            This product has no variants yet, so it cannot be sold.
          </p>
        ) : (
          <div className="flex flex-wrap items-start gap-4">
            {colours.length > 0 && (
              <div>
                <p className="mb-1.5 text-[10px] text-tertiary">Colours</p>
                <div className="flex flex-wrap gap-1.5">
                  {colours.map((colour) => {
                    const swatch = colourSwatch(colour);
                    return swatch ? (
                      <span
                        key={colour}
                        title={colour}
                        className="h-5 w-5 rounded-full border-2 border-border"
                        style={{ background: swatch }}
                      />
                    ) : (
                      <span
                        key={colour}
                        className="rounded border border-border px-1.5 py-0.5 text-[10px] text-secondary"
                      >
                        {colour}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
            {sizes.length > 0 && (
              <div>
                <p className="mb-1.5 text-[10px] text-tertiary">Sizes</p>
                <div className="flex flex-wrap gap-1">
                  {sizes.map((size) => (
                    <span
                      key={size}
                      className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-secondary"
                    >
                      {size}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="border-b border-border">
        <div className="flex" role="tablist" aria-label="Product details">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              onClick={() => setTab(entry.id)}
              className={cn(
                "flex-1 border-b-2 py-2.5 text-xs font-medium transition-colors",
                tab === entry.id
                  ? "border-[color:var(--color-primary)]"
                  : "border-transparent text-tertiary hover:text-secondary",
              )}
              style={tab === entry.id ? { color: "var(--color-primary)" } : undefined}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 px-4 py-3">
        {tab === "stock" &&
          (detail.storeStock.length === 0 ? (
            <Empty>This product has never been counted in any store.</Empty>
          ) : (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold text-secondary">
                  Counted stock (all stores)
                </span>
                <span className="text-sm font-extrabold text-primary">{totalCounted}</span>
              </div>
              <div className="space-y-2">
                {detail.storeStock.map((row) => (
                  <div key={row.storeId} className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs text-secondary">
                      {row.storeName}
                      <span className="text-tertiary"> #{row.storeCode}</span>
                    </span>
                    <span className="text-xs font-semibold text-primary">{row.quantity}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[10px] leading-relaxed text-tertiary">
                An operational count, not an accounting stock ledger.
              </p>
              <Link
                href="/inventory"
                className="mt-3 block rounded-xl border border-border py-2 text-center text-xs font-semibold text-secondary hover:bg-background-hover"
              >
                Open inventory
              </Link>
            </div>
          ))}

        {tab === "pricing" &&
          (product.variantCount === 0 ? (
            <Empty>No variants, so nothing is priced yet.</Empty>
          ) : (
            <div className="space-y-2">
              {product.variants.map((variant) => {
                const variantDiscount = discountPercent(variant.priceMinor, variant.mrpMinor);
                return (
                  <div key={variant.id} className="rounded-lg border border-border p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-primary">
                        {variant.sku}
                      </span>
                      <span className="text-xs font-semibold text-primary">
                        {formatMinor(variant.priceMinor)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-tertiary">
                      <span>
                        {[variant.colour, variant.size].filter(Boolean).join(" · ") || "No options"}
                      </span>
                      <span>
                        {variant.mrpMinor != null ? (
                          <>
                            MRP {formatMinor(variant.mrpMinor)}
                            {variantDiscount !== null && (
                              <span className="ml-1 font-semibold text-danger">
                                {variantDiscount}% off
                              </span>
                            )}
                          </>
                        ) : (
                          "No MRP"
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
              <p className="pt-1 text-[10px] leading-relaxed text-tertiary">
                Margin is not shown: variants carry no cost price, so it cannot be computed.
              </p>
            </div>
          ))}

        {tab === "details" && (
          <div className="space-y-2">
            <Row label="Product" value={product.name} />
            <Row label="Category" value={product.category ?? "Uncategorised"} />
            <Row label="Brand" value={product.brand ?? "No brand"} />
            <Row label="Status" value={product.isActive ? "Active" : "Inactive"} />
            <Row label="Variants" value={product.variantCount} />
            <Row label="Base unit" value={detail.baseUomCode ?? "Not set"} />
            <Row label="Added" value={DATE_FORMAT.format(detail.createdAt)} />
            <Row label="Updated" value={DATE_FORMAT.format(detail.updatedAt)} />
          </div>
        )}

        {tab === "images" && (
          <div>
            {showImage ? (
              <div className="aspect-square overflow-hidden rounded-lg bg-background-subtle">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={product.imageUrl!}
                  alt={product.name}
                  loading="lazy"
                  onError={() => setFailedUrl(product.imageUrl)}
                  className="h-full w-full object-cover"
                />
              </div>
            ) : (
              <Empty>
                {product.imageUrl
                  ? "This product’s picture could not be loaded."
                  : "No picture has been set for this product."}
              </Empty>
            )}
            <p className="mt-3 text-[10px] leading-relaxed text-tertiary">
              A product holds one picture today. Multiple images need a media model AMBURAX does
              not have yet.
            </p>
          </div>
        )}

        {tab === "sales" &&
          (detail.sales === null ? (
            <Empty>This product has never been sold.</Empty>
          ) : (
            <div className="space-y-2">
              <Row
                label={`Units sold (${detail.sales.windowDays} days)`}
                value={detail.sales.unitsSold}
              />
              <Row
                label={`Revenue (${detail.sales.windowDays} days)`}
                value={formatMinor(detail.sales.revenueMinor)}
              />
              <Row
                label="Last sold"
                value={detail.sales.lastSoldAt ? DATE_FORMAT.format(detail.sales.lastSoldAt) : "—"}
              />
              <p className="pt-1 text-[10px] leading-relaxed text-tertiary">
                Completed sales across the whole business, not only this store.
              </p>
            </div>
          ))}
      </div>

      <div className="border-t border-border px-4 py-3">
        <p className="mb-2 text-xs font-semibold text-secondary">Quick actions</p>
        <div className="grid grid-cols-2 gap-1.5">
          <Link
            href="/inventory"
            className="flex flex-col items-center gap-1 rounded-xl border border-border px-1 py-2 text-[10px] font-medium text-secondary hover:bg-background-hover"
          >
            <Boxes
              aria-hidden="true"
              className="h-3.5 w-3.5"
              style={{ color: "var(--color-primary)" }}
            />
            Update stock
          </Link>
          {canManage && (
            <Link
              href={`/products/${product.id}/variants/new`}
              className="flex flex-col items-center gap-1 rounded-xl border border-border px-1 py-2 text-[10px] font-medium text-secondary hover:bg-background-hover"
            >
              <Plus
                aria-hidden="true"
                className="h-3.5 w-3.5"
                style={{ color: "var(--color-primary)" }}
              />
              Create variant
            </Link>
          )}
        </div>
      </div>

      <p className="px-4 pb-4 text-[10px] text-tertiary">
        Stock in this store:{" "}
        {stockStatusLabel(stockStatusOf(product.stockQuantity), product.stockQuantity)}
      </p>
    </aside>
  );
}
