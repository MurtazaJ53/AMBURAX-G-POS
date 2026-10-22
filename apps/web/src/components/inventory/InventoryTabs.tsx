import Link from "next/link";

/**
 * The Inventory screen's tab strip.
 *
 * - Low Stock is the existing `status=low_stock` stock filter (1..LOW_STOCK_MAX_UNITS units,
 *   tenant- and store-scoped by the same query as the table).
 * - Categories and Brands (`tab=categories|brands`) are read-only lists of the values already on
 *   this store's products.
 * - Variants (`tab=variants`) is a read-only list of the variants stocked in this store.
 * - Expiring / Aging stays disabled: its requirements are not decided.
 */

export type InventoryTab = "variants" | "categories" | "brands";

const ACTIVE = "border-b-2 border-primary px-3 py-2 text-[11px] font-semibold text-primary whitespace-nowrap";
const LINK = "border-b-2 border-transparent px-3 py-2 text-[11px] font-semibold text-secondary hover:text-primary transition-colors whitespace-nowrap";
const DISABLED = "border-b-2 border-transparent px-3 py-2 text-[11px] font-semibold text-tertiary whitespace-nowrap cursor-not-allowed";

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} className={active ? ACTIVE : LINK} aria-current={active ? "page" : undefined}>
      {children}
    </Link>
  );
}

/**
 * `path` (the current pathname) is passed on the screens Inventory links to, so the same line stays
 * on Transfers, Stock Take, Products and the rest with that screen marked. Without it (the overview
 * itself) the overview / Low Stock / Variants / Categories / Brands tabs work as before.
 */
export function InventoryTabs({ status, tab, path }: { status?: string; tab?: InventoryTab; path?: string }) {
  const onSubScreen = Boolean(path && path !== "/inventory");
  const at = (href: string) => Boolean(path && (path === href || path.startsWith(`${href}/`)));
  const lowStockActive = !onSubScreen && !tab && status === "low_stock";
  const overviewActive = !onSubScreen && !tab && !lowStockActive;

  return (
    <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
      {overviewActive ? (
        <div className={ACTIVE} aria-current="page">
          Stock Overview
        </div>
      ) : (
        <Link href="/inventory" className={LINK}>
          Stock Overview
        </Link>
      )}
      <TabLink href="/products" active={at("/products")}>
        Products
      </TabLink>
      <TabLink href="/inventory?tab=variants" active={tab === "variants"}>
        Variants
      </TabLink>
      <TabLink href="/inventory?tab=categories" active={tab === "categories"}>
        Categories
      </TabLink>
      <TabLink href="/inventory?tab=brands" active={tab === "brands"}>
        Brands
      </TabLink>
      <TabLink href="/inventory/adjustments/new" active={at("/inventory/adjustments")}>
        Stock Adjustments
      </TabLink>
      <TabLink href="/inventory/receipts/new" active={at("/inventory/receipts")}>
        Receive Stock
      </TabLink>
      <TabLink href="/inventory/transfers" active={at("/inventory/transfers")}>
        Transfers
      </TabLink>
      <TabLink href="/inventory/movements" active={at("/inventory/movements")}>
        Movements
      </TabLink>
      <TabLink href="/inventory?status=low_stock" active={lowStockActive}>
        Low Stock
      </TabLink>
      <TabLink href="/inventory/replenishment" active={at("/inventory/replenishment")}>
        Replenish
      </TabLink>
      <TabLink href="/inventory/stock-take" active={at("/inventory/stock-take")}>
        Stock Take
      </TabLink>
      <TabLink href="/inventory/aging" active={at("/inventory/aging")}>
        Aging
      </TabLink>
      <TabLink href="/inventory/locations" active={at("/inventory/locations")}>
        Locations
      </TabLink>
      <TabLink href="/inventory/reservations" active={at("/inventory/reservations")}>
        Reservations
      </TabLink>
    </div>
  );
}
