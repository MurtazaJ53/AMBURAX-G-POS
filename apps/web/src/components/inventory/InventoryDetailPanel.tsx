import Link from "next/link";
import { X, Package, History } from "lucide-react";
import { type StockLevel, type ProductVariant, type Product } from "@prisma/client";

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

  return (
    <aside className="flex w-full flex-col overflow-hidden rounded-lg border border-border bg-background-card shadow-sm xl:sticky xl:top-[82px] xl:self-start">
      <div className="flex items-center justify-between border-b border-border p-4">
        <h2 className="text-sm font-bold text-primary">Stock Details</h2>
        <Link
          href={closeHref}
          className="rounded hover:bg-background-app p-1 text-secondary transition-colors"
          aria-label="Close details"
        >
          <X className="h-5 w-5" />
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex gap-3">
          <div className="h-20 w-16 shrink-0 overflow-hidden rounded-md bg-background-app">
            { }
            {p.imageUrl ? (
              <img src={p.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-tertiary">
                <Package className="h-6 w-6" />
              </div>
            )}
          </div>
          <div className="min-w-0 pt-1">
            <b className="text-sm text-primary">{p.name}</b>
            {v.size || v.colour ? (
              <p className="text-[10px] text-secondary mt-0.5">
                {[v.size, v.colour].filter(Boolean).join(" / ")}
              </p>
            ) : null}
            <p className="mt-1">
              <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
                {p.isActive ? "Active" : "Inactive"}
              </span>
            </p>
            <p className="mt-2 text-[10px] text-secondary font-mono">SKU: {v.sku}</p>
          </div>
        </div>

        <div className="mt-4 flex border-b border-border">
          <button className="flex-1 border-b-2 border-primary py-2 text-[10px] font-medium text-primary">
            Overview
          </button>
        </div>

        <div className="grid grid-cols-2 gap-x-2 gap-y-4 py-4 text-[10px]">
          <div>
            <p className="text-secondary">Category</p>
            <b className="mt-1 block text-primary">{p.category || "None"}</b>
          </div>
          <div>
            <p className="text-secondary">Brand</p>
            <b className="mt-1 block text-primary">{p.brand || "None"}</b>
          </div>
        </div>

        <div className="grid grid-cols-2 rounded-lg border border-border bg-background-app p-3">
          <div>
            <p className="text-secondary text-[10px]">Total Stock</p>
            <b className="mt-1 block text-primary">{item.quantity}</b>
          </div>
          <div>
            <p className="text-secondary text-[10px]">Available</p>
            <b className="mt-1 block text-primary">{item.quantity}</b>
          </div>
        </div>

        <div className="divide-y divide-border text-[10px] mt-4">
          <div className="flex justify-between py-3">
            <span className="text-secondary">Last Updated</span>
            <b className="text-primary">{item.updatedAt.toLocaleString()}</b>
          </div>
        </div>
      </div>

      <div className="border-t border-border p-4 flex gap-2">
        <Link
          href={`/inventory/movements?search=${encodeURIComponent(v.sku)}`}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-background-card px-3 py-2 text-xs font-semibold text-primary transition-colors hover:bg-background-app focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        >
          <History className="h-3.5 w-3.5" />
          History
        </Link>
        {canManage && (
          <Link
            href={`/inventory/adjustments/new?sku=${encodeURIComponent(v.sku)}`}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            style={{ background: "var(--color-primary)" }}
          >
            Adjust Stock
          </Link>
        )}
      </div>
    </aside>
  );
}
