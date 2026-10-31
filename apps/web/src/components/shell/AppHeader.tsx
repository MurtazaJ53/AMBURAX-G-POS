"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Menu, Plus } from "lucide-react";
import { StoreSwitcher, type StoreOption } from "./StoreSwitcher";
import { GlobalSearch } from "./GlobalSearch";
import { UserMenu } from "./UserMenu";
import { OfflineIndicatorPill } from "@/client/pos/OfflineIndicatorPill";

export interface AppHeaderProps {
  storeName: string;
  storeCode: string;
  storeId?: string;
  availableStores?: StoreOption[];
  userName: string;
  roleLabel: string;
  canSell: boolean;
  tillOpen?: boolean;
  onMobileMenuToggle: () => void;
}

export function AppHeader({
  storeName,
  storeCode,
  storeId,
  availableStores = [],
  userName,
  roleLabel,
  canSell,
  tillOpen = false,
  onMobileMenuToggle,
}: AppHeaderProps) {
  const router = useRouter();

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;

      if (event.key === "F2" && canSell && !typing) {
        event.preventDefault();
        router.push("/pos");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, canSell]);

  return (
    <header className="sticky top-0 z-30 flex h-[68px] shrink-0 items-center gap-3 border-b border-slate-200/80 bg-white/95 px-4 backdrop-blur md:px-6 print:hidden">
      <button
        type="button"
        onClick={onMobileMenuToggle}
        className="flex min-h-11 min-w-11 items-center justify-center rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
        aria-label="Open navigation"
      >
        <Menu size={19} />
      </button>

      <StoreSwitcher
        storeName={storeName}
        storeCode={storeCode}
        currentStoreId={storeId}
        availableStores={availableStores}
      />

      <GlobalSearch />

      <div className="relative ml-auto flex items-center gap-2">
        {/* Offline Queue & Connectivity Visualizer */}
        <div className="hidden sm:flex items-center">
          <OfflineIndicatorPill />
        </div>

        <div className="hidden h-9 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-[10px] lg:flex">
          <span className="text-left leading-tight">
            <b className="block font-bold text-slate-700">{tillOpen ? "Shift Active" : "Shift"}</b>
            <small className="text-slate-500 font-semibold text-[9px] leading-none">
              {tillOpen ? "Live" : "No shift"}
            </small>
          </span>
        </div>

        {canSell && (
          <Link
            href="/pos"
            className="flex min-h-11 lg:min-h-0 lg:h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[11px] font-semibold text-white shadow-sm shadow-sky-700/20 transition hover:bg-primary-hover"
          >
            <Plus size={14} />
            <span className="hidden sm:inline">New Sale (F2)</span>
            <span className="sm:hidden">Sale</span>
          </Link>
        )}

        <button
          type="button"
          disabled
          className="relative flex min-h-11 min-w-11 items-center justify-center rounded-md p-2 text-slate-300 opacity-60 cursor-not-allowed"
          aria-label="Notifications"
          title="Notifications coming soon"
        >
          <Bell size={17} />
        </button>

        <UserMenu userName={userName} roleLabel={roleLabel} />
      </div>
    </header>
  );
}
