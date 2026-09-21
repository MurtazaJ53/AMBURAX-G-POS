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
    <div className="mt-4 grid gap-3 lg:grid-cols-3 xl:grid-cols-[1fr_0.95fr_1.45fr] items-start">
      <section className="rounded-[6px] border border-border bg-background-card p-4 shadow-sm flex flex-col">
        <h3 className="text-[11px] font-bold text-primary uppercase tracking-wider mb-4">Stock by Category</h3>
        <div className="space-y-3 flex-1">
          {stockByCategory.length === 0 ? (
            <p className="text-[11px] text-secondary">No categories with stock.</p>
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
                <div key={c.name} className="grid grid-cols-[85px_1fr_42px_35px] items-center gap-2 text-[11px]">
                  <span className="truncate text-secondary">• {c.name}</span>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div className={`h-full ${colorClass}`} style={{ width: `${p}%` }} />
                  </div>
                  <b className="text-right text-primary font-mono">{c.count}</b>
                  <span className="text-secondary text-right font-mono text-[10px]">({Math.round(p)}%)</span>
                </div>
              );
            })
          )}
        </div>
      </section>

      <section className="rounded-[6px] border border-border bg-background-card p-4 shadow-sm flex flex-col">
        <h3 className="text-[11px] font-bold text-primary uppercase tracking-wider mb-4">Stock by Status</h3>
        <div className="flex-1 flex flex-col items-center justify-center gap-6">
          <div className="relative grid h-[100px] w-[100px] place-items-center rounded-full bg-slate-50">
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: `conic-gradient(#10B981 0% 70%, #F59E0B 70% 90%, #EF4444 90% 100%)`,
                opacity: 0.15
              }}
            />
            <div className="grid h-[76px] w-[76px] place-items-center rounded-full bg-white z-10 shadow-sm border border-slate-100">
              <div className="text-center">
                <b className="text-[16px] font-mono tracking-tight text-primary block leading-none mb-1">{totalUnits}</b>
                <p className="text-[9px] font-bold uppercase tracking-wider text-secondary">Units</p>
              </div>
            </div>
          </div>
          <div className="w-full space-y-2.5 text-[11px]">
            <p className="flex justify-between items-center px-4">
              <span className="text-secondary flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500"></span> In Stock</span>
              <b className="text-primary font-mono">{inStock}</b>
            </p>
            <p className="flex justify-between items-center px-4">
              <span className="text-secondary flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-500"></span> Low Stock</span>
              <b className="text-primary font-mono">{lowStock}</b>
            </p>
            <p className="flex justify-between items-center px-4">
              <span className="text-secondary flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-500"></span> Out of Stock</span>
              <b className="text-primary font-mono">{outOfStock}</b>
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-[6px] border border-border bg-background-card p-4 shadow-sm flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[11px] font-bold text-primary uppercase tracking-wider">Recent Movements</h3>
          <Link href="/inventory/movements" className="text-[10px] font-bold text-blue-600 hover:underline uppercase tracking-wider">
            View All
          </Link>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto max-h-[160px] pr-1">
          <div className="divide-y divide-slate-100">
            {recentMovements.length === 0 ? (
              <p className="text-[11px] text-secondary py-2">No recent movements.</p>
            ) : (
              recentMovements.map((m) => {
                const isAdd = m.quantityDelta > 0;
                const isSub = m.quantityDelta < 0;
                const color = m.type === "SALE" ? "text-red-600" : m.type === "RECEIPT" ? "text-emerald-600" : "text-blue-600";
                
                return (
                  <div key={m.id} className="flex items-center justify-between gap-3 py-2 text-[11px]">
                    <div className="flex items-center gap-1.5 min-w-[75px]">
                      {m.type === "RECEIPT" ? <ArrowUpRight className={`h-3 w-3 ${color}`} /> : m.type === "SALE" ? <ArrowDownRight className={`h-3 w-3 ${color}`} /> : <RotateCcw className={`h-3 w-3 ${color}`} />}
                      <span className={`font-bold ${color} tracking-tight`}>{m.type === "OPENING_BALANCE" ? "OPENING" : m.type}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-primary font-bold truncate leading-tight">{m.variant.product.name}</p>
                      <p className="text-secondary font-mono text-[10px] truncate">{m.variant.sku}</p>
                    </div>
                    <div className="text-right min-w-[45px]">
                      <b className={`${color} font-mono text-[12px]`}>
                        {isAdd ? "+" : ""}{m.quantityDelta}
                      </b>
                    </div>
                    <div className="text-right min-w-[70px] hidden sm:block">
                      <span className="text-secondary font-mono text-[10px]">
                        {m.occurredAt.toLocaleDateString('en-GB')}
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
