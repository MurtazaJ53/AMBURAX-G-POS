"use client";

import * as React from "react";
import Link from "next/link";
import {
  Boxes,
  Pencil,
  Plus,
  Printer,
  X,
  ExternalLink,
  Barcode,
  Layers,
  ShoppingBag,
  TrendingUp,
  Tag,
  CheckCircle,
  Package,
  Camera,
  AlertTriangle,
  Check,
  ArrowRight,
  SlidersHorizontal,
} from "lucide-react";
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
import { taxRateModeLabel, taxTreatmentLabel } from "@/lib/taxWording";
import { cn } from "@/lib/utils";
import { PrintBarcodeButton } from "@/app/(app)/products/[id]/PrintBarcodeButton";

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
    <div className="flex items-start justify-between gap-2 py-2 text-xs border-b border-slate-50 last:border-none">
      <span className="text-slate-500 font-medium">{label}</span>
      <span className="text-right font-semibold text-slate-800">{value}</span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-xs text-slate-400 italic">{children}</p>;
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function ProductDetailPanel({
  detail,
  filters,
  canManage,
}: {
  detail: ProductDetail;
  filters: CatalogFilters;
  canManage: boolean;
}) {
  const [tab, setTab] = React.useState<DetailTab>("stock");
  const [activeStoreFilter, setActiveStoreFilter] = React.useState<string>("all");
  const { product } = detail;

  // Extract distinct colors and sizes
  const colours = Array.from(
    new Set(product.variants.map((v) => v.colour).filter((c): c is string => Boolean(c))),
  );
  const sizes = Array.from(
    new Set(product.variants.map((v) => v.size).filter((s): s is string => Boolean(s))),
  );

  const totalCounted = detail.storeStock.reduce((acc, row) => acc + row.quantity, 0);

  // Print barcoding variants
  const printableVariants = React.useMemo(() => {
    return product.variants.map((v) => {
      const stockRow = detail.storeStock.find((s) => s.variantId === v.id);
      const stockQty = stockRow && stockRow.quantity > 0 ? stockRow.quantity : 1;
      return {
        id: v.id,
        sku: v.sku,
        barcode: v.barcode,
        productName: product.name,
        size: v.size,
        colour: v.colour,
        priceMinor: v.priceMinor ?? 0,
        mrpMinor: v.mrpMinor,
        quantity: stockQty,
      };
    });
  }, [product, detail.storeStock]);

  // Matrix calculation: Color x Size breakdown
  const matrixData = React.useMemo(() => {
    const rows = colours.length > 0 ? colours : ["Standard"];
    const cols = sizes.length > 0 ? sizes : ["Standard"];

    return rows.map((clr) => {
      let rowTotal = 0;
      const sizeQuantities = cols.map((sz) => {
        const matchingVariants = product.variants.filter(
          (v) => (v.colour || "Standard") === clr && (v.size || "Standard") === sz,
        );
        const qty = matchingVariants.reduce((sum, v) => {
          return sum + (v.stockQuantity ?? 0);
        }, 0);
        rowTotal += qty;
        return { size: sz, qty };
      });

      return {
        colour: clr,
        sizeQuantities,
        rowTotal,
      };
    });
  }, [product.variants, colours, sizes]);

  // Column totals
  const colTotals = React.useMemo(() => {
    const cols = sizes.length > 0 ? sizes : ["Standard"];
    return cols.map((sz) => {
      const colTotal = product.variants
        .filter((v) => (v.size || "Standard") === sz)
        .reduce((sum, v) => sum + (v.stockQuantity ?? 0), 0);
      return { size: sz, total: colTotal };
    });
  }, [product.variants, sizes]);

  // First variant details for badges & setup checks
  const firstVariant = product.variants[0];
  const hasCost = firstVariant && (firstVariant as any).costPriceMinor != null;
  const hasPriceAndMrp = firstVariant && firstVariant.priceMinor > 0;
  const hasStock = totalCounted > 0;
  const hasBarcodes = product.variants.some((v) => Boolean(v.barcode));
  const hasPhoto = Boolean(product.imageUrl);

  // Setup progress counter (e.g., 3 of 5 done)
  const setupTasks = [
    { label: "Price & MRP", done: hasPriceAndMrp },
    { label: "Opening stock", done: hasStock },
    { label: "Barcodes", done: hasBarcodes },
    { label: "Add cost price", done: hasCost, isPendingAction: true, href: `/products/${product.id}/edit` },
    { label: "Add photo", done: hasPhoto, isPendingAction: true, href: `/products/${product.id}/edit` },
  ];
  const doneCount = setupTasks.filter((t) => t.done).length;

  return (
    <aside
      aria-label="Product details"
      className="flex h-full w-[440px] shrink-0 flex-col overflow-y-auto border-l border-slate-200/80 bg-slate-50/40 shadow-2xl transition-all"
    >
      {/* 1. Header Bar: QUICK VIEW + Open full page + Close */}
      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200/80 bg-white/95 px-5 py-3 backdrop-blur-sm">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
          Quick View
        </span>
        <div className="flex items-center gap-3">
          <Link
            href={`/products/${product.id}`}
            className="group flex items-center gap-1 text-xs font-bold text-sky-700 hover:text-sky-900 transition-colors"
          >
            <span>Open full page</span>
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link
            href={catalogHref({ ...filters, selectedId: null })}
            aria-label="Close product details"
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
          >
            <X className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="p-5 space-y-4">
        {/* 2. Top Hero Media Banner */}
        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-br from-slate-100/90 to-sky-50/50 shadow-inner flex flex-col items-center justify-center">
          {product.imageUrl ? (
            <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
          ) : (
            <span className="text-7xl font-extrabold tracking-tight text-slate-300 select-none">
              {product.name.trim().charAt(0).toUpperCase() || "P"}
            </span>
          )}

          {/* Top-right "Add photo" or "Change photo" button, for catalogue managers only */}
          {canManage && (
          <Link
            href={`/products/${product.id}/edit`}
            className="absolute right-3.5 top-3.5 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white/95 px-3 py-1.5 text-xs font-bold text-sky-900 shadow-sm backdrop-blur hover:bg-white transition-all"
          >
            <Camera className="h-3.5 w-3.5 text-sky-600" />
            <span>{product.imageUrl ? "Change photo" : "Add photo"}</span>
          </Link>
          )}

          {/* Bottom-left Swatch Capsule */}
          {colours.length > 0 && (
            <div className="absolute bottom-3.5 left-3.5 flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/95 px-3 py-1 shadow-sm backdrop-blur">
              <div className="flex -space-x-1.5">
                {colours.slice(0, 4).map((c) => (
                  <span
                    key={c}
                    className="inline-block h-3.5 w-3.5 rounded-full border-2 border-white shadow-2xs"
                    style={{ background: colourSwatch(c) || "#475569" }}
                  />
                ))}
              </div>
              <span className="text-[11px] font-semibold text-slate-700">
                {colours.length} {colours.length === 1 ? "colour" : "colours"} · {sizes.length} {sizes.length === 1 ? "size" : "sizes"}
              </span>
            </div>
          )}
        </div>

        {/* 3. Product Title & Active Status + Badges */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-black tracking-tight text-slate-900">{product.name}</h1>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold",
                product.isActive
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200/80"
                  : "bg-slate-100 text-slate-500 border border-slate-200",
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {product.isActive ? "Active" : "Archived"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {product.brand && (
              <span className="rounded-full border border-slate-200 bg-white px-3 py-0.5 text-xs text-slate-600 shadow-2xs">
                Brand <b className="text-slate-900">{product.brand}</b>
              </span>
            )}
            {product.category && (
              <span className="rounded-full border border-slate-200 bg-white px-3 py-0.5 text-xs text-slate-600 shadow-2xs">
                Category <b className="text-slate-900">{product.category}</b>
              </span>
            )}
          </div>

          <p className="text-xs text-slate-500 font-medium">
            {product.variantCount} variants · {sizes.length} sizes × {colours.length || 1} colours · {detail.baseUomCode || "Pieces (PCS)"}
          </p>
        </div>

        {/* 4. White Pricing Banner Card */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-baseline gap-2.5">
            <span className="text-2xl font-black tracking-tight text-slate-900">
              {product.priceFromMinor !== null ? formatMinor(product.priceFromMinor) : "₹0.00"}
            </span>
            {firstVariant?.mrpMinor && firstVariant?.priceMinor && firstVariant.mrpMinor > firstVariant.priceMinor && (
              <>
                <span className="text-sm font-semibold text-slate-400 line-through">
                  {formatMinor(firstVariant.mrpMinor)}
                </span>
                <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700 border border-emerald-200">
                  {discountPercent(firstVariant.priceMinor, firstVariant.mrpMinor)}% off
                </span>
              </>
            )}
          </div>

          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 border border-slate-200">
            {firstVariant?.taxRateMode === "APPAREL_SLAB"
              ? "Apparel Slab (5%/18%)"
              : firstVariant?.taxTreatment === "NON_GST"
              ? "Non-GST · 0%"
              : `${(firstVariant?.taxRateBp ?? 0) / 100}% GST`}
          </span>
        </div>

        {/* 5. Triple Stat Cards (IN STOCK / LOCATIONS / VARIANTS) */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-2xs">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              In Stock
            </span>
            <span className="mt-1 block text-xl font-black text-slate-900 tracking-tight">
              {totalCounted.toLocaleString()}
            </span>
            <span className="text-[11px] font-medium text-slate-500">pcs counted</span>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-2xs">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Locations
            </span>
            <span className="mt-1 block text-xl font-black text-slate-900 tracking-tight">
              {detail.storeStock.length || 1}
            </span>
            <span className="text-[11px] font-medium text-slate-500 truncate block">
              {detail.storeStock[0]?.storeCode ? `#${detail.storeStock[0].storeCode}` : "Main Store"}
            </span>
          </div>

          <div className="rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-2xs">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">
              Variants
            </span>
            <span className="mt-1 block text-xl font-black text-slate-900 tracking-tight">
              {product.variantCount}
            </span>
            <span className="text-[11px] font-medium text-slate-500">
              {sizes.length} sizes × {colours.length || 1} colours
            </span>
          </div>
        </div>

        {/* 6. Product Setup Checklist Card */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between text-xs font-bold">
            <span className="text-slate-900">Product setup</span>
            <span className="text-slate-500">{doneCount} of {setupTasks.length} done</span>
          </div>

          {/* Progress bar */}
          <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all"
              style={{ width: `${(doneCount / setupTasks.length) * 100}%` }}
            />
          </div>

          {/* Pill checklist items */}
          <div className="flex flex-wrap gap-2 pt-1">
            {setupTasks.map((task, idx) => {
              if (task.done) {
                return (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50/80 px-3 py-1 text-xs font-bold text-emerald-800 border border-emerald-200/70"
                  >
                    <Check className="h-3 w-3 stroke-[3] text-emerald-600" />
                    <span>{task.label}</span>
                  </span>
                );
              }
              // Only someone who may edit the catalogue gets a link to the edit page.
              if (!canManage) {
                return (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-amber-300 bg-amber-50/60 px-3 py-1 text-xs font-bold text-amber-900"
                  >
                    <span>{task.label}</span>
                  </span>
                );
              }
              return (
                <Link
                  key={idx}
                  href={task.href || `/products/${product.id}/edit`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-amber-300 bg-amber-50/60 px-3 py-1 text-xs font-bold text-amber-900 hover:bg-amber-100/70 transition-colors"
                >
                  <Plus className="h-3 w-3 text-amber-700" />
                  <span>{task.label}</span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* 7. Tab Strip (Stock / Pricing / Details / Images / Sales) */}
        <div className="border-b border-slate-200 pt-1">
          <div className="flex gap-4" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "border-b-2 pb-2.5 text-xs font-bold transition-all",
                  tab === t.id
                    ? "border-sky-800 text-sky-900"
                    : "border-transparent text-slate-400 hover:text-slate-700",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* 8. Tab Content */}
        {tab === "stock" && (
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm space-y-4">
            {/* Store Filter Pills */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveStoreFilter("all")}
                className={cn(
                  "rounded-full px-3.5 py-1 text-xs font-bold transition-all",
                  activeStoreFilter === "all"
                    ? "bg-sky-900 text-white shadow-2xs"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                )}
              >
                All stores
              </button>
              {detail.storeStock.map((s) => (
                <button
                  key={s.storeId}
                  type="button"
                  onClick={() => setActiveStoreFilter(s.storeId)}
                  className={cn(
                    "rounded-full px-3.5 py-1 text-xs font-bold transition-all",
                    activeStoreFilter === s.storeId
                      ? "bg-sky-900 text-white shadow-2xs"
                      : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                  )}
                >
                  #{s.storeCode} {s.storeName}
                </button>
              ))}
            </div>

            {/* Matrix Table: Colour / Size Grid */}
            <div className="overflow-x-auto pt-1">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-slate-400 font-semibold border-b border-slate-100">
                    <th className="pb-2 font-medium">Colour / Size</th>
                    {(sizes.length > 0 ? sizes : ["Standard"]).map((sz) => (
                      <th key={sz} className="pb-2 text-center font-bold text-slate-600">
                        {sz}
                      </th>
                    ))}
                    <th className="pb-2 text-right font-bold text-slate-900">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {matrixData.map((row) => (
                    <tr key={row.colour} className="hover:bg-slate-50/50">
                      <td className="py-2.5 font-bold text-slate-800 flex items-center gap-2">
                        <span
                          className="h-3 w-3 rounded-full border border-slate-300 shrink-0"
                          style={{ background: colourSwatch(row.colour) || "#334155" }}
                        />
                        <span>{row.colour}</span>
                      </td>
                      {row.sizeQuantities.map((sq, i) => (
                        <td key={i} className="py-2.5 text-center">
                          <span
                            className={cn(
                              "inline-block rounded-lg px-2.5 py-1 font-bold tabular-nums text-xs",
                              sq.qty > 0
                                ? "bg-sky-50 text-sky-900"
                                : "text-slate-300",
                            )}
                          >
                            {sq.qty}
                          </span>
                        </td>
                      ))}
                      <td className="py-2.5 text-right font-bold text-slate-900 tabular-nums">
                        {row.rowTotal}
                      </td>
                    </tr>
                  ))}
                  {/* Total Row */}
                  <tr className="border-t-2 border-slate-200 font-extrabold text-slate-900">
                    <td className="pt-3">Total</td>
                    {colTotals.map((c) => (
                      <td key={c.size} className="pt-3 text-center tabular-nums">
                        {c.total}
                      </td>
                    ))}
                    <td className="pt-3 text-right text-sky-900 tabular-nums text-sm">
                      {totalCounted.toLocaleString()}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Store Location stock indicator */}
            <div className="border-t border-slate-100 pt-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-slate-900">
                  {detail.storeStock[0]?.storeName || "Main Store"}{" "}
                  <span className="text-slate-400 font-mono text-[11px]">
                    #{detail.storeStock[0]?.storeCode || "MAIN"}
                  </span>
                </p>
                <p className="text-[11px] text-slate-500">Counted stock</p>
              </div>
              <span className="text-base font-extrabold text-slate-900">
                {totalCounted.toLocaleString()} pcs
              </span>
            </div>

            <div className="flex items-center justify-between pt-1 text-[11px] text-slate-400">
              <span>An operational count, not an accounting ledger.</span>
              <Link href="/inventory" className="font-bold text-sky-700 hover:underline">
                Go to Inventory →
              </Link>
            </div>
          </div>
        )}

        {tab === "pricing" && (
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm space-y-2">
            <Row
              label="Selling Price"
              value={product.priceFromMinor != null ? formatMinor(product.priceFromMinor) : "—"}
            />
            <Row
              label="MRP"
              value={firstVariant?.mrpMinor ? formatMinor(firstVariant.mrpMinor) : "—"}
            />
            <Row
              label="Garment Tax Mode"
              value={taxRateModeLabel(firstVariant?.taxRateMode)}
            />
            <Row
              label="Tax Treatment"
              value={taxTreatmentLabel(firstVariant?.taxTreatment)}
            />
            <Row
              label="Default GST Rate"
              value={`${(firstVariant?.taxRateBp ?? 0) / 100}%`}
            />
            {product.variants.length > 0 && (
              <ul aria-label="Variant prices" className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
                {product.variants.map((variant) => (
                  <li key={variant.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-slate-800">{variant.sku}</span>
                      <span className="block text-[10px] text-slate-500">
                        {[variant.colour, variant.size].filter(Boolean).join(" · ") || "No options"}
                        {variant.mrpMinor != null ? ` · MRP ${formatMinor(variant.mrpMinor)}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 font-bold text-slate-900">{formatMinor(variant.priceMinor)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === "details" && (
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm space-y-2">
            <Row label="Product ID" value={<span className="font-mono text-[10px]">{product.id}</span>} />
            <Row label="Brand" value={product.brand || "—"} />
            <Row label="Category" value={product.category || "—"} />
            <Row label="HSN Code" value={product.hsnCode ? <span className="font-mono">{product.hsnCode}</span> : "—"} />
            <Row label="Base Unit" value={product.baseUom ? `${product.baseUom.name} (${product.baseUom.code})` : "Pieces (PCS)"} />
            <Row label="Created Date" value={DATE_FORMAT.format(new Date(product.createdAt))} />
          </div>
        )}

        {tab === "images" && (
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm space-y-3">
            {product.imageUrl ? (
              <div className="aspect-square w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
                <img src={product.imageUrl} alt="" className="h-full w-full object-cover" />
              </div>
            ) : (
              <Empty>No picture set for this product.</Empty>
            )}
          </div>
        )}

        {tab === "sales" && (
          <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            {detail.sales === null ? (
              <Empty>This product has never been sold.</Empty>
            ) : (
              <div className="space-y-2">
                <Row label={`Units sold (${detail.sales.windowDays} days)`} value={detail.sales.unitsSold} />
                <Row label={`Revenue (${detail.sales.windowDays} days)`} value={formatMinor(detail.sales.revenueMinor)} />
                <Row label="Last sold" value={detail.sales.lastSoldAt ? DATE_FORMAT.format(detail.sales.lastSoldAt) : "—"} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* 9. Bottom Floating Action Buttons: Edit product / Adjust stock / Print labels */}
      <div className="sticky bottom-0 z-20 border-t border-slate-200/80 bg-white/95 p-4 backdrop-blur-sm">
        <div className="grid grid-cols-3 gap-2">
          {canManage && (
            <Link
              href={`/products/${product.id}/edit`}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-sky-900 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-sky-950 transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
              <span>Edit product</span>
            </Link>
          )}

          {canManage && (
            <Link
              href={`/products/${product.id}/variants/new`}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors"
            >
              <Plus className="h-3.5 w-3.5 text-slate-500" />
              <span>Create variant</span>
            </Link>
          )}

          <Link
            href="/inventory"
            className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-slate-500" />
            <span>Adjust stock</span>
          </Link>

          {printableVariants.length > 0 && (
            <PrintBarcodeButton
              variants={printableVariants}
              buttonLabel="Print labels"
              className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors"
            />
          )}
        </div>
      </div>
    </aside>
  );
}
