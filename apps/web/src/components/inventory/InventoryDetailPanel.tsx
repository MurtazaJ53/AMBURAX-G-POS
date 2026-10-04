"use client";
import Link from "next/link";
import { X, Package } from "lucide-react";
import { type StockLevel, type ProductVariant, type Product } from "@prisma/client";
import { StatusPill, type Status } from "./InventoryUI";
import { formatMinor } from "@/server/sales/saleTotals";

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

  const st: Status = item.quantity > 10 ? "In Stock" : item.quantity > 0 ? "Low Stock" : item.quantity < 0 ? "Negative" : "Out of Stock";

  const currency = (value: number) => formatMinor(value);

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @media (prefers-reduced-motion: reduce) {
          .anim-fade { animation: none !important; }
          .anim-slide { animation: none !important; }
        }
        .anim-fade { animation: fadeIn 0.2s ease-out forwards; }
        .anim-slide { animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .anim-none { animation: none !important; }
      `}} />

      {/* Mobile Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40 xl:hidden anim-fade" aria-hidden="true">
        <Link href={closeHref} className="absolute inset-0 block" tabIndex={-1} prefetch={false} />
      </div>

      {/* Panel */}
      <aside 
        className="fixed inset-y-0 right-0 z-50 flex w-[90%] max-w-[380px] flex-col overflow-hidden bg-background-card shadow-2xl anim-slide xl:static xl:h-full xl:w-[380px] xl:max-w-none xl:rounded-[8px] xl:border xl:border-border xl:shadow-sm xl:anim-none"
        aria-label="Product details"
        role="dialog"
      >
        <div className="flex shrink-0 items-start justify-between border-b border-border bg-slate-50 p-4">
          <div>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-secondary">Selected product</div>
            <h2 className="text-sm font-bold text-primary">Product Details</h2>
          </div>
          <Link
            href={closeHref}
            prefetch={false}
            className="flex h-7 w-7 items-center justify-center rounded-md text-secondary transition-colors hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Close details"
          >
            <X className="h-4 w-4" />
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 bg-white">
          <div className="flex gap-4 border-b border-border p-4">
            <div className="flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[5px] bg-slate-100 border border-slate-200">
              {p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.imageUrl} alt={p.name} className="h-full w-full object-cover" />
              ) : (
                <Package className="h-6 w-6 text-slate-300" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[15px] font-bold leading-tight text-primary">{p.name}</h2>
              <div className="mt-1 truncate font-mono text-[11px] text-secondary">
                {v.sku} &bull; {p.brand || "No brand"}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <StatusPill status={st} />
              </div>
            </div>
          </div>

          <div className="p-4 text-[11px]">
            <div className="grid grid-cols-2 gap-x-2 gap-y-4">
              <div>
                <label className="block text-[10px] font-bold text-secondary mb-1">Category</label>
                <strong className="text-primary">{p.category || "None"}</strong>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-secondary mb-1">Brand</label>
                <strong className="text-primary">{p.brand || "None"}</strong>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-secondary mb-1">Sales Price</label>
                <strong className="font-mono text-primary text-[12px]">{currency(v.priceMinor)}</strong>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-secondary mb-1">Last updated</label>
                <strong className="text-primary">
                  {new Intl.DateTimeFormat("en-US", {
                    timeZone: "Asia/Kolkata",
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                  }).format(item.updatedAt)}
                </strong>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-2 rounded-lg border border-border bg-slate-50 p-3 text-center">
              <div>
                <label className="block text-[10px] font-bold text-secondary mb-1">Total Stock</label>
                <strong className="font-mono text-sm text-primary">{item.quantity}</strong>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-secondary mb-1">Available</label>
                <strong className="font-mono text-sm text-primary">{item.quantity}</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 gap-2 border-t border-border bg-slate-50 p-4">
          <Link
            href={`/inventory/movements?q=${encodeURIComponent(v.sku)}`}
            prefetch={false}
            className="flex flex-1 items-center justify-center rounded-[6px] border border-slate-300 bg-white px-3 py-2 text-[11px] font-semibold text-primary shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            View Stock History
          </Link>
          {canManage && (
            <Link
              href={`/inventory/adjustments/new?sku=${encodeURIComponent(v.sku)}`}
              prefetch={false}
              className="flex flex-1 items-center justify-center rounded-[6px] border border-transparent bg-primary px-3 py-2 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Adjust Stock
            </Link>
          )}
        </div>
      </aside>
    </>
  );
}
