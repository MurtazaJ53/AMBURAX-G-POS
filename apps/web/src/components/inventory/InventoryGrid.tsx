"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Grid2X2, Boxes, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StockLevel, ProductVariant, Product } from "@prisma/client";

type DetailStock = StockLevel & {
  variant: ProductVariant & {
    product: Product;
  };
};

export type ViewMode = "table" | "grid";

export function StatusPill({ status }: { status: string }) {
  let style = "bg-slate-100 text-slate-700";
  if (status === "In Stock") style = "bg-success-10 text-success";
  if (status === "Low Stock") style = "bg-warning-10 text-warning";
  if (status === "Out of Stock") style = "bg-danger-10 text-danger";
  if (status === "Negative") style = "bg-danger-20 text-danger";

  return (
    <span
      className={cn("inline-flex whitespace-nowrap rounded px-2 py-1 text-[11px] font-semibold", style)}
    >
      {status}
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

function Thumb({ imageUrl, name, className }: { imageUrl: string | null; name: string; className?: string }) {
  const [failedUrl, setFailedUrl] = React.useState<string | null>(null);

  if (!imageUrl || failedUrl === imageUrl) {
    return <Initial name={name} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageUrl}
      alt=""
      loading="lazy"
      onError={() => setFailedUrl(imageUrl)}
      className={cn("h-full w-full object-cover", className)}
    />
  );
}

export function InventoryToolbar({
  total,
  view,
  search,
  status,
  category,
  brand,
}: {
  total: number;
  view: ViewMode;
  search?: string;
  status?: string;
  category?: string;
  brand?: string;
}) {
  const router = useRouter();
  
  const onViewChange = (newView: ViewMode) => {
    const p = new URLSearchParams();
    if (search) p.set("q", search);
    if (status) p.set("status", status);
    if (category) p.set("category", category);
    if (brand) p.set("brand", brand);
    if (newView !== "table") p.set("view", newView);
    router.push(`/inventory?${p.toString()}`);
  };

  return (
    <div className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-background-card px-4">
      <div className="text-xs font-medium text-secondary">
        {total} {total === 1 ? "variant" : "variants"}
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center rounded border border-border bg-background-app p-0.5">
          {(
            [
              { id: "table", icon: Grid2X2, label: "Table view" },
              { id: "grid", icon: Boxes, label: "Grid view" },
            ] as const
          ).map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              aria-label={label}
              aria-pressed={view === id}
              onClick={() => onViewChange(id)}
              className={cn(
                "rounded-sm p-1.5 text-secondary transition-colors",
                view === id
                  ? "bg-background-card text-primary shadow-sm"
                  : "hover:bg-background-hover hover:text-primary",
              )}
            >
              <Icon aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function InventoryGrid({
  items,
  selectedSku,
  view,
  search,
  status,
  category,
  brand,
}: {
  items: DetailStock[];
  selectedSku?: string;
  view: ViewMode;
  search?: string;
  status?: string;
  category?: string;
  brand?: string;
}) {
  const router = useRouter();

  const onSelect = (sku: string | undefined) => {
    const p = new URLSearchParams();
    if (search) p.set("q", search);
    if (status) p.set("status", status);
    if (category) p.set("category", category);
    if (brand) p.set("brand", brand);
    if (view !== "table") p.set("view", view);
    if (sku) p.set("selected", sku);
    
    router.push(`/inventory?${p.toString()}`);
  };

  if (view === "table") {
    return (
      <div className="min-w-0 flex-1 overflow-x-auto bg-background-card">
        <table className="w-full min-w-[800px] border-collapse text-left text-[11px]">
          <thead className="bg-background-app text-[10px] text-tertiary">
            <tr>
              <th className="border-b border-border px-4 py-2 font-semibold uppercase tracking-wider">Product</th>
              <th className="border-b border-border px-4 py-2 font-semibold uppercase tracking-wider">SKU</th>
              <th className="border-b border-border px-4 py-2 font-semibold uppercase tracking-wider">Category</th>
              <th className="border-b border-border px-4 py-2 font-semibold uppercase tracking-wider">Brand</th>
              <th className="border-b border-border px-4 py-2 text-right font-semibold uppercase tracking-wider">Stock &darr;</th>
              <th className="border-b border-border px-4 py-2 font-semibold uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map(p => {
              const st = p.quantity > 10 ? "In Stock" : p.quantity > 0 ? "Low Stock" : p.quantity < 0 ? "Negative" : "Out of Stock";
              const isSelected = selectedSku === p.variant.sku;
              return (
                <tr 
                  key={p.variant.sku} 
                  className={cn(
                    "group transition-colors hover:bg-background-hover cursor-pointer",
                    isSelected && "bg-background-active"
                  )}
                  onClick={() => onSelect(isSelected ? undefined : p.variant.sku)}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 shrink-0 overflow-hidden rounded bg-background-app">
                        <Thumb imageUrl={p.variant.product.imageUrl} name={p.variant.product.name} />
                      </div>
                      <div className="min-w-0">
                        <b className="block truncate text-primary group-hover:underline">{p.variant.product.name}</b>
                        {p.variant.size || p.variant.colour ? (
                          <span className="block truncate text-[10px] text-secondary mt-0.5">
                            {[p.variant.size, p.variant.colour].filter(Boolean).join(" / ")}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-secondary">{p.variant.sku}</td>
                  <td className="px-4 py-2.5 text-secondary">{p.variant.product.category || "—"}</td>
                  <td className="px-4 py-2.5 text-secondary">{p.variant.product.brand || "—"}</td>
                  <td className="px-4 py-2.5 text-right font-bold text-primary">{p.quantity}</td>
                  <td className="px-4 py-2.5"><StatusPill status={st} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 p-4 md:grid-cols-3 xl:grid-cols-4 content-start">
      {items.map(p => {
        const st = p.quantity > 10 ? "In Stock" : p.quantity > 0 ? "Low Stock" : p.quantity < 0 ? "Negative" : "Out of Stock";
        const isSelected = selectedSku === p.variant.sku;
        
        return (
          <button 
            key={p.variant.sku} 
            type="button"
            onClick={() => onSelect(isSelected ? undefined : p.variant.sku)}
            className={cn(
              "flex flex-col text-left overflow-hidden rounded-lg border bg-background-card transition-all hover:shadow-md",
              isSelected ? "border-[color:var(--color-primary)] ring-1 ring-[color:var(--color-primary)]" : "border-border"
            )}
          >
            <div className="aspect-[4/5] w-full bg-background-app border-b border-border">
              <Thumb imageUrl={p.variant.product.imageUrl} name={p.variant.product.name} />
            </div>
            <div className="p-3 flex-1 flex flex-col min-w-0 w-full">
              <b className="block truncate text-xs font-bold text-primary mb-0.5">{p.variant.product.name}</b>
              <span className="block truncate font-mono text-[10px] text-secondary mb-2">{p.variant.sku}</span>
              
              <div className="mt-auto flex items-end justify-between">
                <div>
                  <span className="block text-[10px] text-tertiary">Stock</span>
                  <span className="text-sm font-bold text-primary">{p.quantity}</span>
                </div>
                <StatusPill status={st} />
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
