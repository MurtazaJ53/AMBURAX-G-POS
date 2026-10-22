"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAVIGATION, type NavItem } from "./navigation";

/**
 * The persistent product navigation.
 *
 * A client component only because the active item depends on the current path. Which
 * entries exist is fixed in `navigation.ts`, and every destination re-authorizes the caller
 * for itself — the sidebar is wayfinding, never permission.
 *
 * Planned modules are shown, dimmed, with their phase. They are reachable: the screen
 * behind them says plainly that the module is not built. Hiding them would misrepresent
 * the product; making them look live would misrepresent the build.
 */

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavRow({ item, active }: { item: NavItem; active: boolean }) {
  const planned = item.status === "planned";

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={[
        "group flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
        active
          ? "bg-blue-50 font-semibold text-blue-700"
          : planned
            ? "text-slate-400 hover:bg-slate-50 hover:text-slate-600"
            : "font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900",
      ].join(" ")}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden="true"
          className={[
            "h-1.5 w-1.5 shrink-0 rounded-full",
            active ? "bg-primary" : planned ? "bg-slate-200" : "bg-slate-300",
          ].join(" ")}
        />
        <span className="truncate">{item.label}</span>
      </span>
      {planned && item.phase && (
        <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
          {item.phase.replace("Phase ", "P")}
        </span>
      )}
    </Link>
  );
}

export function Sidebar(props: { storeName: string; storeCode: string }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      {/* Brand. The product is AMBURAX POS — a generic retail platform with garments as the
          first vertical, so the strapline is deliberately not garment-specific. */}
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white"
        >
          A
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-bold tracking-tight text-slate-900">
            AMBURAX POS
          </span>
          <span className="block text-[11px] text-slate-400">Retail operating system</span>
        </span>
      </div>

      {/* Store context. One store per tenant is what the system supports today, so this
          states the active outlet rather than offering a switcher that cannot switch. */}
      <div className="mx-3 mb-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Active store
        </p>
        <p className="mt-1 truncate text-sm font-semibold text-slate-900">{props.storeName}</p>
        <p className="text-xs text-slate-500">#{props.storeCode}</p>
      </div>

      <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {NAVIGATION.map((section, index) => (
          <div key={section.title ?? "primary"} className={index > 0 ? "mt-5" : ""}>
            {section.title && (
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {section.title}
              </p>
            )}
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => (
                <NavRow key={item.href} item={item} active={isActive(pathname, item.href)} />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </div>
  );
}
