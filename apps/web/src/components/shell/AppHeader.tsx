"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Clock3, Menu, Plus } from "lucide-react";
import { StoreSwitcher } from "./StoreSwitcher";
import { GlobalSearch } from "./GlobalSearch";
import { UserMenu } from "./UserMenu";
import { cn } from "@/lib/utils";

export interface AppHeaderProps {
  storeName: string;
  storeCode: string;
  userName: string;
  roleLabel: string;
  canSell: boolean;
  tillOpen?: boolean;
  onMobileMenuToggle: () => void;
}

function useOnlineStatus(): boolean {
  const [online, setOnline] = React.useState(true);

  React.useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  return online;
}

export function AppHeader({
  storeName,
  storeCode,
  userName,
  roleLabel,
  canSell,
  tillOpen = false,
  onMobileMenuToggle,
}: AppHeaderProps) {
  const router = useRouter();
  const online = useOnlineStatus();

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
    <header className="sticky top-0 z-30 flex h-[68px] shrink-0 items-center gap-3 border-b border-slate-200/80 bg-white/95 px-4 backdrop-blur md:px-6">
      <button
        type="button"
        onClick={onMobileMenuToggle}
        className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
        aria-label="Open navigation"
      >
        <Menu size={19} />
      </button>

      <StoreSwitcher storeName={storeName} storeCode={storeCode} />

      <GlobalSearch />

      <div className="relative ml-auto flex items-center gap-2">
        

        <span className="hidden items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-2 text-[10px] font-semibold text-emerald-700 sm:flex">
          <i className={cn("size-1.5 rounded-full", online ? "bg-emerald-500" : "bg-slate-400")} /> {online ? "Store Online" : "Store Offline"}
        </span>

        <button type="button" className="hidden h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-[10px] lg:flex">
          <span className="text-left leading-tight">
            <b className="block font-bold text-slate-700">{tillOpen ? 'Shift #02' : 'Shift'}</b>
            <small className="text-slate-400 font-semibold text-[9px] leading-none">{tillOpen ? 'Live' : 'No shift'}</small>
          </span>
        </button>

        {canSell && (
          <Link
            href="/pos"
            className="flex h-9 items-center gap-1.5 rounded-md bg-sky-600 px-3 text-[11px] font-semibold text-white shadow-sm shadow-sky-700/20 transition hover:bg-sky-700"
          >
            <Plus size={14} /> 
            <span className="hidden sm:inline">New Sale (F2)</span>
            <span className="sm:hidden">Sale</span>
          </Link>
        )}

        <button type="button" className="relative rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Notifications">
          <Bell size={17} />
          <i className="absolute right-[5px] top-[5px] flex size-3 items-center justify-center rounded-full border-2 border-white bg-rose-500 text-[8px] font-bold text-white">1</i>
        </button>

        <UserMenu userName={userName} roleLabel={roleLabel} />
      </div>
    </header>
  );
}
