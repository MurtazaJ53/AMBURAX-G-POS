"use client";

import * as React from "react";
import { Menu, Plus } from "lucide-react";
import { StoreSwitcher } from "./StoreSwitcher";
import { GlobalSearch } from "./GlobalSearch";
import { UserMenu } from "./UserMenu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useRouter } from "next/navigation";

export interface AppHeaderProps {
  storeName: string;
  storeCode: string;
  userName: string;
  roleLabel: string;
  canSell: boolean;
  onMobileMenuToggle: () => void;
}

export function AppHeader({ storeName, storeCode, userName, roleLabel, canSell, onMobileMenuToggle }: AppHeaderProps) {
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
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-border bg-background-card px-4">
      <div className="flex items-center gap-2 lg:hidden">
        <button
          onClick={onMobileMenuToggle}
          className="text-secondary hover:bg-background-hover rounded p-1.5 transition-colors"
          aria-label="Open sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      <div className="flex items-center gap-4">
        <StoreSwitcher storeName={storeName} storeCode={storeCode} />
      </div>

      <div className="flex-1 flex justify-center max-w-2xl px-4 hidden sm:flex">
        <GlobalSearch />
      </div>

      <div className="flex items-center gap-2 sm:gap-4">
        <Badge variant="warning" className="hidden xl:inline-flex items-center gap-1.5 h-7" title="No ERPNext adapter is connected. Sales are recorded in AMBURAX and not yet posted to accounting.">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-warning" />
          <span className="font-medium">Accounting not connected</span>
        </Badge>

        {canSell && (
          <Button asChild size="sm" className="hidden sm:flex gap-1.5">
            <Link href="/pos">
              <Plus className="h-4 w-4" />
              New Sale
              <kbd className="hidden rounded bg-white/20 px-1 text-[10px] font-medium lg:inline">
                F2
              </kbd>
            </Link>
          </Button>
        )}

        <div className="pl-0 sm:pl-2 border-l-0 sm:border-l border-border">
          <UserMenu userName={userName} roleLabel={roleLabel} />
        </div>
      </div>
    </header>
  );
}
