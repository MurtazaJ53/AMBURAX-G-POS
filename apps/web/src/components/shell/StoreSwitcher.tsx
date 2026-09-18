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
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-md hover:bg-background-hover p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <div className="flex h-7 w-7 items-center justify-center rounded bg-background-subtle border border-border text-secondary">
          <Store className="h-4 w-4" />
        </div>
        <div className="hidden md:block text-left">
          <p className="truncate text-sm font-medium text-primary leading-tight">{storeName}</p>
          <p className="text-[10px] text-tertiary leading-tight">#{storeCode}</p>
        </div>
        <ChevronDown className="h-4 w-4 text-tertiary hidden md:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuLabel className="text-xs text-tertiary uppercase tracking-wider">
          Active Store
        </DropdownMenuLabel>
        <DropdownMenuItem className="flex flex-col items-start gap-1 p-2 bg-background-subtle">
          <span className="text-sm font-medium text-primary">{storeName}</span>
          <span className="text-xs text-secondary">#{storeCode}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
