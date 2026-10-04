"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Store, X, Cloud } from "lucide-react";
import { NAVIGATION } from "./navigation";
import { cn } from "@/lib/utils";

export interface AppSidebarProps {
  tenantCapabilities: string[];
  tenantName?: string;
  storeName?: string;
  storeCode?: string;
  tillOpen?: boolean;
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
  isMobileOpen,
  onMobileClose,
}: AppSidebarProps) {
  const pathname = usePathname();

  const filteredNav = React.useMemo(() => {
    return NAVIGATION.map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (!item.capabilities || item.capabilities.length === 0) return true;
        return item.capabilities.some((cap) => tenantCapabilities.includes(cap));
      }),
    })).filter((section) => section.items.length > 0);
  }, [tenantCapabilities]);

  const SidebarContent = (
    <aside className={cn(
      "fixed inset-y-0 left-0 z-40 flex w-[238px] flex-col border-r border-slate-200 bg-white text-slate-700 shadow-xl shadow-slate-900/5 transition-transform duration-200 lg:translate-x-0 print:hidden",
      isMobileOpen ? "translate-x-0" : "-translate-x-full"
    )}>
      <div className="relative flex h-[68px] items-center justify-between border-b border-slate-200 px-5">
        <div>
          <div className="flex items-center gap-2 text-[15px] font-bold tracking-[.14em] text-slate-900">
            <span className="flex size-5 items-center justify-center rounded bg-sky-600 text-[12px] font-bold text-white">A</span>
            AMBURAX
          </div>
          <div className="mt-1 pl-7 text-[9px] tracking-[.08em] text-slate-400">
            {tenantName || 'OPERATIONS OS'} &middot; V1.0
          </div>
        </div>
        <button type="button" className="rounded p-1 text-slate-500 hover:bg-slate-100 lg:hidden" onClick={onMobileClose} aria-label="Close navigation">
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
            <i className={cn("size-1.5 rounded-full", tillOpen ? "bg-emerald-500" : "bg-slate-300")} /> {tillOpen ? 'Live' : 'Offline'}
          </span>
          <span className="text-slate-400">Asia/Kolkata</span>
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
                  className={cn(
                    "group mb-1 flex items-center gap-3 rounded-md px-3 py-2 text-[11px] font-medium transition-colors",
                    active ? "bg-sky-50 text-sky-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  )}
                >
                  <Icon size={15} strokeWidth={1.8} />
                  <span>{item.label}</span>
                  {active && <span className="ml-auto size-1.5 rounded-full bg-sky-600" />}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="relative border-t border-slate-100 p-4 pb-3">
        <div className="rounded-lg bg-sky-50/50 p-3 pb-0 relative overflow-hidden">
          <div className="relative z-10">
            <div className="mb-1 text-[11px] font-bold text-sky-800">
              Grow Your Business
            </div>
            <p className="text-[10px] leading-snug text-slate-500">New season collection setup<br/>in 2 steps</p>
            <Link href="/products" className="mt-2.5 mb-3 inline-block rounded border border-sky-600 bg-sky-600 px-3 py-1.5 text-[10px] font-bold text-white hover:bg-sky-700">
              Add Products
            </Link>
          </div>
          <div className="absolute right-[-10px] bottom-0 opacity-80 h-[50px] w-[60px] bg-sky-100 rounded"></div>
        </div>
        <div className="mt-3.5 flex items-center justify-between text-[11px] text-slate-600 font-medium">
          <span className="flex items-center gap-1.5"><Cloud size={14} className="text-slate-400" /> Cloud Sync</span>
          <span className="text-[9px] text-slate-400 font-normal">Just now</span>
        </div>
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
