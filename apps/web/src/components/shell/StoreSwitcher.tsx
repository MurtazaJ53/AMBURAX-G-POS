"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Check, ChevronDown, Loader2, Store } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { switchStoreDirectAction } from "@/app/select-store/actions";

export interface StoreOption {
  id: string;
  name: string;
  code: string;
  city?: string;
  state?: string;
  isDefault?: boolean;
}

interface StoreSwitcherProps {
  storeName: string;
  storeCode: string;
  currentStoreId?: string;
  availableStores?: StoreOption[];
}

export function StoreSwitcher({
  storeName,
  storeCode,
  currentStoreId,
  availableStores = [],
}: StoreSwitcherProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();
  const [switchingId, setSwitchingId] = React.useState<string | null>(null);

  const handleStoreSelect = (storeId: string) => {
    if (storeId === currentStoreId) return;
    setSwitchingId(storeId);
    startTransition(async () => {
      try {
        const res = await switchStoreDirectAction(storeId);
        if (res.success) {
          router.refresh();
        } else {
          alert(res.message || "Failed to switch store");
        }
      } catch (e) {
        console.error("Store switch error", e);
      } finally {
        setSwitchingId(null);
      }
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={isPending}
        className="hidden h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-left text-[10px] md:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-100 cursor-pointer disabled:opacity-60"
      >
        {isPending ? (
          <Loader2 size={14} className="animate-spin text-primary" />
        ) : (
          <Store size={14} className="text-primary" />
        )}
        <span className="min-w-0">
          <b className="block max-w-[116px] truncate font-semibold text-slate-700">{storeName}</b>
          <small className="text-[9px] text-slate-500">Store #{storeCode}</small>
        </span>
        <ChevronDown size={13} className="text-slate-400" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 max-h-[380px] overflow-y-auto">
        <DropdownMenuLabel className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
          Select Active Store
        </DropdownMenuLabel>

        {availableStores.length > 0 ? (
          availableStores.map((s) => {
            const isActive = s.id === currentStoreId || s.code === storeCode;
            const isTarget = switchingId === s.id;
            return (
              <DropdownMenuItem
                key={s.id}
                onClick={() => handleStoreSelect(s.id)}
                disabled={isPending || isActive}
                className={`flex items-center justify-between p-2.5 cursor-pointer rounded-lg ${
                  isActive ? "bg-primary-subtle text-primary font-semibold" : "hover:bg-slate-50"
                }`}
              >
                <div className="flex flex-col items-start min-w-0 pr-2">
                  <span className="text-sm font-medium text-slate-900 truncate">{s.name}</span>
                  <span className="text-xs text-slate-500">
                    #{s.code} {s.city ? `· ${s.city}` : ""}
                  </span>
                </div>
                {isTarget ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                ) : isActive ? (
                  <Check className="h-4 w-4 text-primary shrink-0" />
                ) : null}
              </DropdownMenuItem>
            );
          })
        ) : (
          <DropdownMenuItem className="flex flex-col items-start gap-1 p-2 bg-slate-50">
            <span className="text-sm font-medium text-slate-800">{storeName}</span>
            <span className="text-xs text-slate-500">#{storeCode}</span>
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onClick={() => router.push("/select-store?switch=1")}
          className="gap-2 text-slate-600 hover:text-slate-900 cursor-pointer"
        >
          <ArrowLeftRight className="h-4 w-4 text-slate-500" />
          <span className="text-xs font-medium">All Stores & Locations</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
