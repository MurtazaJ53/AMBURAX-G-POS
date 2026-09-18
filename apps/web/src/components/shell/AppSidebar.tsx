"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Store, X } from "lucide-react";
import { NAVIGATION, type NavItem } from "./navigation";
import { cn } from "@/lib/utils";

/**
 * The workspace sidebar.
 *
 * Rebuilt to the design reference's proportions — a 13rem rail, a branded header block, an
 * active-store card, dense 12px navigation rows and a soft-blue active state — while keeping
 * the F2 navigation architecture untouched underneath. The rows are still generated from
 * `NAVIGATION` metadata and still filtered by tenant capability; only their appearance
 * changed.
 *
 * Every piece of identity here is passed in from the resolved session. The reference shows a
 * fixed "ATELIER RETAIL / Indiranagar Store / #01", and none of those strings exist in this
 * file: a tenant that renamed itself yesterday sees the new name today.
 */

export interface AppSidebarProps {
  tenantCapabilities: string[];
  /** The business, as it named itself. */
  tenantName?: string;
  storeName?: string;
  storeCode?: string;
  /** Whether a till is currently open in this store. Drives the live dot, honestly. */
  tillOpen?: boolean;
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/home") return pathname === "/home";
  return pathname === href || pathname.startsWith(href + "/");
}

function NavRow({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick?: () => void;
}) {
  const planned = item.status === "planned";
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group mb-0.5 flex items-center justify-between gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus",
        active
          ? "bg-primary-subtle font-semibold"
          : planned
            ? "text-tertiary hover:bg-background-hover hover:text-secondary"
            : "text-secondary hover:bg-background-hover hover:text-primary",
      )}
      style={active ? { color: "var(--color-primary)" } : undefined}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <Icon
          className={cn("h-4 w-4 shrink-0", !active && "text-tertiary")}
          style={active ? { color: "var(--color-primary)" } : undefined}
        />
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

  // Capability filtering is UX, not authorization: a hidden module is still refused by the
  // server if someone types its URL. It exists so a wholesale-only business is not asked to
  // scroll past a till it does not own.
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
    <div className="flex h-full flex-col border-r border-border bg-background-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
            style={{ background: "var(--color-primary)" }}
          >
            A
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-bold leading-none tracking-tight text-primary">
              AMBURAX
            </span>
            <span className="mt-0.5 block truncate text-[10px] text-tertiary">
              {tenantName ?? "Business platform"}
            </span>
          </span>
        </div>
        {onMobileClose && (
          <button
            onClick={onMobileClose}
            className="rounded p-1 text-secondary hover:bg-background-hover lg:hidden"
            aria-label="Close sidebar"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {storeName && (
        <div className="mx-3 mb-2 mt-3 rounded-xl border border-border bg-background-subtle px-3 py-2">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-tertiary">
            Active store
          </p>
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-xs font-semibold text-primary">{storeName}</p>
            {storeCode && <span className="shrink-0 text-[10px] text-tertiary">#{storeCode}</span>}
          </div>
          <div className="mt-0.5 flex items-center gap-1">
            {/* Reflects a real open PosSession. The reference shows a permanent green "Live";
                a dot that is always on is decoration, not status. */}
            <span
              aria-hidden="true"
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                tillOpen ? "bg-success" : "bg-background-active",
              )}
            />
            <span
              className={cn("text-[10px] font-medium", tillOpen ? "text-success" : "text-tertiary")}
            >
              {tillOpen ? "Till open" : "No till open"}
            </span>
          </div>
        </div>
      )}

      <nav aria-label="Main" className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2 py-1">
        {filteredNav.map((section) => (
          <div key={section.title ?? "primary"}>
            {section.title && (
              <p className="px-3 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-tertiary">
                {section.title}
              </p>
            )}
            <div className="flex flex-col">
              {section.items.map((item) => (
                <NavRow
                  key={item.href}
                  item={item}
                  active={isActive(pathname, item.href)}
                  onClick={onMobileClose}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="flex items-center gap-2 border-t border-border px-4 py-2.5">
        <Store aria-hidden="true" className="h-3 w-3 text-tertiary" />
        <span className="text-[10px] text-tertiary">
          {storeCode ? `Store #${storeCode}` : "No store"}
        </span>
        <span className="ml-auto text-[10px] text-tertiary">
          {tenantCapabilities.length} module{tenantCapabilities.length === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:fixed lg:inset-y-0 lg:z-40 lg:flex lg:w-52 lg:flex-col">
        {SidebarContent}
      </aside>

      {isMobileOpen && (
        <div
          className="relative z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <div className="fixed inset-0 bg-black/50 transition-opacity" onClick={onMobileClose} />
          <div className="fixed inset-y-0 left-0 flex w-60 max-w-[80vw]">
            <div className="w-full">{SidebarContent}</div>
          </div>
        </div>
      )}
    </>
  );
}
