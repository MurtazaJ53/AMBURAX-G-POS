"use client";
import Link from "next/link";
import { X, Package, ExternalLink } from "lucide-react";
import { type StockLevel, type ProductVariant, type Product } from "@prisma/client";
import { StatusPill, type Status } from "./InventoryUI";
import { useState } from "react";

type DetailStock = StockLevel & {
  variant: ProductVariant & {
    product: Product;
  };
};

export function InventoryDetailPanel({
  item,
  closeHref,
  canManage,
}: {
  item: DetailStock;
  closeHref: string;
  canManage: boolean;
}) {
  const p = item.variant.product;
  const v = item.variant;
  const [tab, setTab] = useState<"Overview" | "Variants" | "Stock History">("Overview");

  const st: Status = item.quantity > 10 ? "In Stock" : item.quantity > 0 ? "Low Stock" : item.quantity < 0 ? "Negative" : "Out of Stock";

  const currency = (value: number) => `Rs. ${(value / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

  return (
    <aside className="flex h-full min-h-0 w-full xl:w-[380px] shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-background-card shadow-md">
      <div className="flex items-start justify-between border-b border-border p-4 bg-slate-50">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-secondary mb-1">Selected product</div>
          <h2 className="text-sm font-bold text-primary">Product Details</h2>
        </div>
        <Link
          href={closeHref}
          className="rounded p-1 text-secondary transition-colors hover:bg-slate-200"
          aria-label="Close details"
        >
          <X className="h-4 w-4" />
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="flex gap-4 p-4 border-b border-border">
          <div className="h-20 w-16 shrink-0 overflow-hidden rounded-[5px] bg-slate-100 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {p.imageUrl ? (
              <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <Package className="h-6 w-6 text-slate-300" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-bold text-primary truncate leading-tight">{p.name}</h2>
            <div className="text-[11px] text-secondary mt-1 font-mono truncate">
              {v.sku} &bull; {p.brand || "No brand"}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <StatusPill status={st} />
            </div>
          </div>
        </div>

        <div className="flex border-b border-border px-2">
          {(["Overview", "Variants", "Stock History"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2.5 text-[11px] font-semibold transition-colors ${tab === t ? "border-b-2 border-primary text-primary" : "border-b-2 border-transparent text-secondary hover:text-primary"}`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="p-4 text-[11px]">
          {tab === "Overview" && (
            <>
              <div className="grid grid-cols-2 gap-y-4 gap-x-2">
                <div>
                  <label className="text-[10px] font-bold text-secondary block">Category</label>
                  <strong className="text-primary">{p.category || "None"}</strong>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-secondary block">Brand</label>
                  <strong className="text-primary">{p.brand || "None"}</strong>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-secondary block">HSN Code</label>
                  <strong className="text-secondary font-medium">Not available</strong>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-secondary block">Sales Price</label>
                  <strong className="text-primary font-mono">{currency(v.priceMinor)}</strong>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-secondary block">Cost Price</label>
                  <strong className="text-secondary font-medium">Not connected</strong>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-secondary block">Tax</label>
                  <strong className="text-secondary font-medium">Not connected</strong>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-3 gap-2 rounded-lg border border-border bg-slate-50 p-3 text-center">
                <div>
                  <label className="text-[10px] font-bold text-secondary block">Total Stock</label>
                  <strong className="text-primary font-mono text-sm">{item.quantity}</strong>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-secondary block">Reserved</label>
                  <strong className="text-secondary font-mono text-sm">&mdash;</strong>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-secondary block">Available</label>
                  <strong className="text-primary font-mono text-sm">{item.quantity}</strong>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                <div className="flex justify-between">
                  <span className="text-secondary">Reorder level</span>
                  <strong className="text-secondary font-medium">Not available</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-secondary">Location</span>
                  <strong className="text-secondary font-medium">Not available</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-secondary">Last updated</span>
                  <strong className="text-primary">{new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(item.updatedAt)}</strong>
                </div>
              </div>
            </>
          )}

          {tab === "Variants" && (
            <div className="text-secondary py-4 text-center">
              Variant grouping is not yet available in this view.
            </div>
          )}

          {tab === "Stock History" && (
            <div className="flex gap-3 py-4 items-start text-secondary">
              <ExternalLink className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p>Click &quot;View Stock History&quot; below to see all stock movements for this variant.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-auto border-t border-border p-4 bg-slate-50 flex gap-2 shrink-0">
        <Link
          href={`/inventory/movements?q=${encodeURIComponent(v.sku)}`}
          className="flex-1 flex items-center justify-center rounded-[4px] border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-primary hover:bg-slate-50 transition-colors shadow-sm"
        >
          View Stock History
        </Link>
        {canManage && (
          <Link
            href={`/inventory/adjustments/new?sku=${encodeURIComponent(v.sku)}`}
            className="flex-1 flex items-center justify-center rounded-[4px] border border-transparent bg-primary px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 transition-colors shadow-sm"
          >
            Adjust Stock
          </Link>
        )}
      </div>
    </aside>
  );
}
