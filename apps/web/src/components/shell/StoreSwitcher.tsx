"use client";

import * as React from "react";
import { ChevronDown, Store } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";

interface StoreSwitcherProps {
  storeName: string;
  storeCode: string;
}

export function StoreSwitcher({ storeName, storeCode }: StoreSwitcherProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="hidden h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-left text-[10px] md:flex focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-100">
        <Store size={14} className="text-sky-600" />
        <span className="min-w-0">
          <b className="block max-w-[116px] truncate font-semibold text-slate-700">{storeName}</b>
          <small className="text-[9px] text-slate-400">Store #{storeCode}</small>
        </span>
        <ChevronDown size={13} className="text-slate-400" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="text-xs text-tertiary uppercase tracking-wider">
          Active Store
        </DropdownMenuLabel>
        <DropdownMenuItem className="flex flex-col items-start gap-1 p-2 bg-slate-50">
          <span className="text-sm font-medium text-slate-800">{storeName}</span>
          <span className="text-xs text-slate-500">#{storeCode}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
