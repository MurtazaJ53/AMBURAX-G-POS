"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Store, X } from "lucide-react";
import { NAVIGATION } from "./navigation";
import { cn } from "@/lib/utils";

export interface AppSidebarProps {
  tenantCapabilities: string[];
  tenantName?: string;
  storeName?: string;
  storeCode?: string;
  tillOpen?: boolean;
  allowedModules?: string[] | null;
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(href + "/");
}

export function AppSidebar({
  tenantCapabilities,
  tenantName,
  storeName,
  storeCode,
  tillOpen = false,
  allowedModules,
  isMobileOpen,
  onMobileClose,
}: AppSidebarProps) {
  const pathname = usePathname();

  const filteredNav = React.useMemo(() => {
    return NAVIGATION.map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        // 1. Check capability match
        if (item.capabilities && item.capabilities.length > 0) {
          const hasCap = item.capabilities.some((cap) => tenantCapabilities.includes(cap));
          if (!hasCap) return false;
        }

        // 2. Check granular manual module access assigned by owner
        if (allowedModules && Array.isArray(allowedModules)) {
          // Dashboard is always visible to everyone
          if (item.id === "dashboard") return true;
          return allowedModules.includes(item.id);
        }

        return true;
      }),
    })).filter((section) => section.items.length > 0);
  }, [tenantCapabilities, allowedModules]);

  const SidebarContent = (
    <aside
      // While open on mobile the sidebar is a modal drawer over the page, so it says so.
      {...(isMobileOpen ? { role: "dialog", "aria-modal": true, "aria-label": "Navigation" } : {})}
      className={cn(
      "fixed inset-y-0 left-0 z-40 flex w-[238px] flex-col border-r border-slate-200 bg-white text-slate-700 shadow-xl shadow-slate-900/5 transition-transform duration-200 lg:translate-x-0 print:hidden",
      isMobileOpen ? "translate-x-0" : "-translate-x-full"
    )}>
      <div className="relative flex h-[68px] items-center justify-between border-b border-slate-200 px-5">
        <div>
          <div className="flex items-center gap-2 text-[15px] font-bold tracking-[.14em] text-slate-900">
            <span className="flex size-5 items-center justify-center rounded bg-primary text-[12px] font-bold text-white">A</span>
            AMBURAX
          </div>
          <div className="mt-1 pl-7 text-[9px] tracking-[.08em] text-slate-400">
            {tenantName || 'OPERATIONS OS'} &middot; V1.0
          </div>
        </div>
        <button type="button" className="flex min-h-11 min-w-11 items-center justify-center rounded text-slate-500 hover:bg-slate-100 lg:hidden" onClick={onMobileClose} aria-label="Close navigation">
          <X size={17} />
        </button>
      </div>

      <div className="relative mx-4 mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-sky-50 text-sky-700">
            <Store size={15} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[11px] font-semibold text-slate-800">{storeName}</p>
            <p className="mt-0.5 text-[9px] text-slate-400">{storeCode ? `Store #${storeCode}` : 'No Store'}</p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-slate-200 pt-2 text-[9px]">
          <span className={cn("flex items-center gap-1.5", tillOpen ? "text-emerald-700" : "text-slate-500")}>
            {/* This is the till, not the network: the header's "Store Online" is the connection. */}
            <i className={cn("size-1.5 rounded-full", tillOpen ? "bg-emerald-500" : "bg-slate-300")} /> {tillOpen ? 'Till open' : 'No till open'}
          </span>
          <span className="text-slate-500">Asia/Kolkata</span>
        </div>
      </div>

      <nav className="relative mt-5 flex-1 overflow-y-auto px-3 pb-4">
        {filteredNav.map((group) => (
          <div key={group.title || 'group'} className="mb-5">
            <p className="mb-2 px-3 text-[9px] font-semibold uppercase tracking-[.14em] text-slate-400">{group.title}</p>
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  onClick={onMobileClose}
                  // The active route is announced, not only shown in colour.
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group mb-1 flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-[11px] lg:min-h-0 font-medium transition-colors",
                    active ? "bg-sky-50 text-sky-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  )}
                >
                  <Icon size={15} strokeWidth={1.8} />
                  <span>{item.label}</span>
                  {active && <span className="ml-auto size-1.5 rounded-full bg-primary" />}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* A plain shortcut. The earlier promo ("setup in 2 steps", "Cloud Sync · Just now") described
          flows and a sync status that nothing in the product measures. */}
      <div className="border-t border-slate-100 p-4">
        <Link
          href="/products"
          className="amb-focus flex min-h-11 items-center justify-center rounded-md bg-primary px-3 text-[11px] font-bold text-white transition-colors hover:bg-primary-hover"
        >
          Add products
        </Link>
      </div>
    </aside>
  );

  return (
    <>
      {SidebarContent}
      {isMobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={onMobileClose} />
      )}
    </>
  );
}
