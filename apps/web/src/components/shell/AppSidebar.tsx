"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAVIGATION, type NavItem } from "./navigation";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

export interface AppSidebarProps {
  tenantCapabilities: string[];
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/home") return pathname === "/home";
  return pathname === href || pathname.startsWith(href + "/");
}

function NavRow({ item, active, onClick }: { item: NavItem; active: boolean; onClick?: () => void }) {
  const planned = item.status === "planned";
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm transition-colors",
        active
          ? "bg-background-active text-primary font-semibold"
          : planned
            ? "text-tertiary hover:bg-background-hover hover:text-secondary"
            : "font-medium text-secondary hover:bg-background-hover hover:text-primary"
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <Icon className={cn("h-4 w-4 shrink-0", active ? "text-primary" : planned ? "text-tertiary" : "text-secondary")} />
        <span className="truncate">{item.label}</span>
      </span>
      {planned && item.phase && (
        <span className="shrink-0 rounded bg-background-subtle px-1.5 py-0.5 text-[10px] font-medium text-tertiary">
          {item.phase.replace("Phase ", "P")}
        </span>
      )}
    </Link>
  );
}

export function AppSidebar({ tenantCapabilities, isMobileOpen, onMobileClose }: AppSidebarProps) {
  const pathname = usePathname();

  // Filter navigation by capabilities
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
    <div className="flex h-full flex-col bg-background-card border-r border-border">
      <div className="flex h-14 items-center justify-between px-4 border-b border-border">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded bg-primary text-sm font-bold text-white"
          >
            A
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold tracking-tight text-primary">
              AMBURAX
            </span>
            <span className="block text-[10px] text-tertiary uppercase tracking-wider">Operating System</span>
          </span>
        </div>
        {onMobileClose && (
          <button onClick={onMobileClose} className="lg:hidden p-1 text-secondary hover:bg-background-hover rounded" aria-label="Close sidebar">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav aria-label="Main" className="min-h-0 flex-1 overflow-y-auto px-3 py-4 space-y-6">
        {filteredNav.map((section, index) => (
          <div key={section.title ?? "primary"}>
            {section.title && (
              <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-tertiary">
                {section.title}
              </p>
            )}
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => (
                <NavRow key={item.href} item={item} active={isActive(pathname, item.href)} onClick={onMobileClose} />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-60 lg:flex-col lg:fixed lg:inset-y-0 lg:z-40">
        {SidebarContent}
      </aside>

      {/* Mobile Drawer (controlled by isMobileOpen) */}
      {isMobileOpen && (
        <div className="relative z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="fixed inset-0 bg-black/50 transition-opacity" onClick={onMobileClose} />
          <div className="fixed inset-y-0 left-0 w-64 max-w-sm flex">
            <div className="w-full">
              {SidebarContent}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

