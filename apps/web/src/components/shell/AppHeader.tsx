"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Menu, Plus } from "lucide-react";
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
  /** A real open POS session in this store. Drives the shift pill. */
  tillOpen?: boolean;
  onMobileMenuToggle: () => void;
}

/**
 * The application bar.
 *
 * Rebuilt to the reference's layout: store selector, a wide search field, status pills, the
 * primary action, then identity. What did not survive the rebuild is the reference's
 * notification bell with its red "3" Ã¢â‚¬â€ AMBURAX has no notification system, so a bell would
 * either be permanently empty or permanently lying. It returns when there is something to
 * count.
 *
 * The two pills are real signals, not decoration. Connectivity comes from the browser's own
 * online state, and the shift pill comes from an open `PosSession` resolved on the server.
 */

/** The browser's connectivity, which is a genuine operational fact at a counter. */
function useOnlineStatus(): boolean {
  // Starts optimistic so the server and first client render agree; a genuinely offline
  // browser corrects it on mount, which is the only moment the value can be read safely.
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

function StatusPill({
  label,
  detail,
  tone,
}: {
  label: string;
  detail: string;
  tone: "ok" | "idle" | "bad";
}) {
  return (
    <div className="hidden items-center gap-1.5 rounded-xl border border-border px-3 py-2 xl:flex">
      <span
        aria-hidden="true"
        className={cn(
          "h-2 w-2 rounded-full",
          tone === "ok" ? "bg-success" : tone === "bad" ? "bg-danger" : "bg-background-active",
        )}
      />
      <span className="text-xs font-medium text-secondary">{label}</span>
      <span
        className={cn(
          "text-[10px]",
          tone === "ok" ? "text-success" : tone === "bad" ? "text-danger" : "text-tertiary",
        )}
      >
        {detail}
      </span>
    </div>
  );
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
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background-card px-4 sm:gap-3">
      <button
        onClick={onMobileMenuToggle}
        className="rounded-lg p-1.5 text-secondary transition-colors hover:bg-background-hover lg:hidden"
        aria-label="Open sidebar"
      >
        <Menu className="h-5 w-5" />
      </button>

      <StoreSwitcher storeName={storeName} storeCode={storeCode} />

      <div className="flex-1 min-w-0 flex justify-end sm:justify-start">
        <GlobalSearch />
      </div>

      <StatusPill label="Store" detail={online ? "Online" : "Offline"} tone={online ? "ok" : "bad"} />
      <StatusPill label="Till" detail={tillOpen ? "Open" : "Closed"} tone={tillOpen ? "ok" : "idle"} />

      {canSell && (
        <Link
          href="/pos"
          className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus sm:px-4"
          style={{ background: "var(--color-primary)" }}
        >
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">New sale</span>
          <kbd className="hidden rounded bg-white/20 px-1 text-[10px] font-medium lg:inline">F2</kbd>
        </Link>
      )}

      <div className="ml-auto shrink-0 sm:ml-0 sm:border-l sm:border-border sm:pl-2">
        <UserMenu userName={userName} roleLabel={roleLabel} />
      </div>
    </header>
  );
}


