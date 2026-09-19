import Link from "next/link";
import { type StockMovement, type ProductVariant, type Product } from "@prisma/client";
import { ArrowDownRight, ArrowUpRight, RotateCcw } from "lucide-react";

type MovementWithProduct = StockMovement & {
  variant: ProductVariant & {
    product: Product;
  };
};

export function InventoryAnalytics({
  totalUnits,
  inStock,
  lowStock,
  outOfStock,
  stockByCategory,
  recentMovements,
}: {
  totalUnits: number;
  inStock: number;
  lowStock: number;
  outOfStock: number;
  stockByCategory: { name: string; count: number }[];
  recentMovements: MovementWithProduct[];
}) {
  return (
    <div className="mt-4 grid gap-3 xl:grid-cols-[1fr_0.95fr_1.45fr]">
      <section className="rounded-lg border border-border bg-background-card p-4 shadow-sm">
        <h3 className="text-xs font-bold text-primary">Stock by Category</h3>
        <div className="mt-4 space-y-3">
          {stockByCategory.length === 0 ? (
            <p className="text-xs text-secondary py-4">No categories with stock.</p>
          ) : (
            stockByCategory.map((c, i) => {
              const p = totalUnits > 0 ? (c.count / totalUnits) * 100 : 0;
              const colorClasses = [
                "bg-blue-500",
                "bg-emerald-500",
                "bg-purple-500",
                "bg-amber-500",
                "bg-rose-500",
              ];
              const colorClass = colorClasses[i % colorClasses.length];
              
              return (
                <div key={c.name} className="grid grid-cols-[95px_1fr_42px_35px] items-center gap-2 text-[10px]">
                  <span className="truncate text-secondary">● {c.name}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-background-app">
                    <div className={`h-full ${colorClass}`} style={{ width: `${p}%` }} />
                  </div>
                  <b className="text-right text-primary">{c.count}</b>
                  <span className="text-secondary text-right">({Math.round(p)}%)</span>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-background-card p-4 shadow-sm">
        <h3 className="text-xs font-bold text-primary">Stock by Status</h3>
        <div className="mt-6 flex flex-col sm:flex-row items-center justify-around gap-6">
          <div className="relative grid h-24 w-24 place-items-center rounded-full bg-slate-100 dark:bg-slate-800">
            {/* Simple CSS donut approximation */}
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: `conic-gradient(var(--color-success) 0% 70%, var(--color-warning) 70% 90%, var(--color-danger) 90% 100%)`,
                opacity: 0.2
              }}
            />
            <div className="grid h-16 w-16 place-items-center rounded-full bg-background-card text-center z-10 shadow-sm">
              <div>
                <b className="text-sm text-primary">{totalUnits}</b>
                <p className="text-[8px] text-secondary">Total Units</p>
              </div>
            </div>
          </div>
          <div className="space-y-3 text-[10px]">
            <p className="flex justify-between w-32">
              <span className="text-secondary"><span className="text-green-500">●</span> In Stock</span>
              <b className="text-primary">{inStock}</b>
            </p>
            <p className="flex justify-between w-32">
              <span className="text-secondary"><span className="text-amber-500">●</span> Low Stock</span>
              <b className="text-primary">{lowStock}</b>
            </p>
            <p className="flex justify-between w-32">
              <span className="text-secondary"><span className="text-red-500">●</span> Out of Stock</span>
              <b className="text-primary">{outOfStock}</b>
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-background-card p-4 shadow-sm flex flex-col">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-primary">Recent Stock Movements</h3>
          <Link href="/inventory/movements" className="text-[10px] font-semibold text-primary hover:underline">
            View All
          </Link>
        </div>
        <div className="mt-4 flex-1 min-h-0">
          <div className="divide-y divide-border">
            {recentMovements.length === 0 ? (
              <p className="text-xs text-secondary py-4">No recent movements.</p>
            ) : (
              recentMovements.map((m) => {
                const isAdd = m.quantityDelta > 0;
                const isSub = m.quantityDelta < 0;
                const color = m.type === "SALE" ? "text-red-500" : m.type === "RECEIPT" ? "text-green-500" : "text-blue-500";
                
                return (
                  <div key={m.id} className="flex items-center justify-between gap-3 py-2.5 text-[10px]">
                    <div className="flex items-center gap-2 min-w-[80px]">
                      {m.type === "RECEIPT" ? <ArrowUpRight className={`h-3 w-3 ${color}`} /> : m.type === "SALE" ? <ArrowDownRight className={`h-3 w-3 ${color}`} /> : <RotateCcw className={`h-3 w-3 ${color}`} />}
                      <span className={`font-medium ${color}`}>{m.type === "OPENING_BALANCE" ? "OPENING" : m.type}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-primary font-medium truncate">{m.variant.product.name}</p>
                      <p className="text-secondary font-mono truncate">{m.variant.sku}</p>
                    </div>
                    <div className="text-right min-w-[50px]">
                      <b className={color}>
                        {isAdd ? "+" : ""}{m.quantityDelta}
                      </b>
                    </div>
                    <div className="text-right min-w-[80px] hidden sm:block">
                      <span className="text-secondary">
                        {m.occurredAt.toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
