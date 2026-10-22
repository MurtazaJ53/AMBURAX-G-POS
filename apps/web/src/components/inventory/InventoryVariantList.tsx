import Link from "next/link";

/**
 * Read-only Variants view: one row per variant stocked in this store, from the same
 * tenant- and store-scoped `listStockLevels` query as the stock table. Nothing here creates,
 * edits, merges or deletes a variant.
 */

export interface InventoryVariantRow {
  quantity: number;
  variant: {
    sku: string;
    size: string | null;
    colour: string | null;
    barcode: string | null;
    isActive: boolean;
    product: { name: string; isActive: boolean };
  };
}

export function InventoryVariantList({
  rows,
  total,
  page,
  pageSize,
}: {
  rows: InventoryVariantRow[];
  total: number;
  page: number;
  pageSize: number;
}) {
  const first = (page - 1) * pageSize;
  const hasPrev = page > 1;
  const hasNext = first + pageSize < total;
  const pageHref = (p: number) => `/inventory?tab=variants${p > 1 ? `&page=${p}` : ""}`;

  return (
    <section
      aria-label="Variants in this store"
      className="mt-4 flex flex-col overflow-hidden rounded-[6px] border border-border bg-background-card shadow-sm"
    >
      {rows.length === 0 ? (
        <p className="p-12 text-center text-sm text-secondary">No variants are stocked in this store yet.</p>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[800px] border-collapse text-left text-[12px]">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-secondary">
              <tr>
                <th className="px-4 py-2 font-semibold">Product</th>
                <th className="px-4 py-2 font-semibold">SKU</th>
                <th className="px-4 py-2 font-semibold">Size</th>
                <th className="px-4 py-2 font-semibold">Colour</th>
                <th className="px-4 py-2 font-semibold">Barcode</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 text-right font-semibold">On hand</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                // A variant is sellable only when it and its product are both active.
                const active = r.variant.isActive && r.variant.product.isActive;
                return (
                  <tr key={r.variant.sku} className="h-9">
                    <td className="px-4 py-1.5 font-medium text-primary">{r.variant.product.name}</td>
                    <td className="px-4 py-1.5 font-mono text-[11px] text-secondary">{r.variant.sku}</td>
                    <td className="px-4 py-1.5 text-primary">{r.variant.size || "—"}</td>
                    <td className="px-4 py-1.5 text-primary">{r.variant.colour || "—"}</td>
                    <td className="px-4 py-1.5 font-mono text-[11px] text-secondary">{r.variant.barcode || "—"}</td>
                    <td className="px-4 py-1.5 text-primary">{active ? "Active" : "Inactive"}</td>
                    <td className="px-4 py-1.5 text-right font-mono text-[13px] font-bold text-primary">{r.quantity}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {total > 0 && (
        <div className="flex items-center justify-between border-t border-border bg-slate-50 px-4 py-3 text-[10px] text-secondary">
          <span>
            Showing {first + 1}&mdash;{Math.min(first + pageSize, total)} of {total} variants
          </span>
          <div className="flex items-center gap-2">
            {hasPrev && (
              <Link href={pageHref(page - 1)} className="inline-flex h-7 items-center rounded-[4px] border border-border bg-white px-3 font-medium hover:bg-slate-50">
                Previous
              </Link>
            )}
            {hasNext && (
              <Link href={pageHref(page + 1)} className="inline-flex h-7 items-center rounded-[4px] border border-border bg-white px-3 font-medium hover:bg-slate-50">
                Next
              </Link>
            )}
          </div>
        </div>
      )}
      <p className="border-t border-border bg-slate-50 px-4 py-2 text-[10px] text-tertiary">
        Read-only. Edit a product to change its variants.
      </p>
    </section>
  );
}
