"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * The application bar.
 *
 * What is deliberately absent matters as much as what is here. The design reference shows
 * a "Store Online" pill, a live shift indicator and a notification bell. AMBURAX has no
 * connectivity model, no shift model and no notification model, so all three would be
 * decorative claims about system state — exactly the kind of fake status this product
 * forbids.
 *
 * What replaces them is a status that is true and worth knowing at a counter: sales are
 * recorded in AMBURAX and are not yet posted to accounting, because no ERPNext adapter
 * exists (ADR-001).
 */
export function TopBar(props: {
  storeName: string;
  storeCode: string;
  userName: string;
  roleLabel: string;
  canSell: boolean;
}) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Real keyboard shortcuts, not labels on buttons that do nothing. F2 opens the till and
  // "/" focuses search — both skipped while the operator is typing in a field.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;

      if (event.key === "F2" && props.canSell) {
        event.preventDefault();
        router.push("/pos");
        return;
      }
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router, props.canSell]);

  async function signOut() {
    setSigningOut(true);
    await fetch("/api/v1/auth/logout", { method: "POST" });
    router.push("/auth/login");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
      {/* The sidebar is hidden on narrow screens, so the store is named here too. An
          operator must never be unsure which store they are working in. */}
      <div className="min-w-0 lg:hidden">
        <p className="truncate text-sm font-semibold text-slate-900">AMBURAX POS</p>
        <p className="truncate text-xs text-slate-500">
          {props.storeName} · #{props.storeCode}
        </p>
      </div>

      {/* Searches the catalogue, and says so. The placeholder names only what it actually
          searches — promising "customer" here and not searching customers would be a small
          lie the operator discovers at the worst moment. */}
      <form method="get" action="/products" className="hidden min-w-0 flex-1 md:block">
        <label htmlFor="global-search" className="sr-only">
          Search products by name, SKU or barcode
        </label>
        <div className="relative max-w-xl">
          <input
            id="global-search"
            ref={searchRef}
            name="q"
            placeholder="Search products, SKU, barcode…"
            className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2 pl-3 pr-12 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          <kbd
            aria-hidden="true"
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-400"
          >
            /
          </kbd>
        </div>
      </form>

      <div className="ml-auto flex items-center gap-3">
        {/* A true statement about system state, not a decorative "all systems operational". */}
        <span
          title="No ERPNext adapter is connected. Sales are recorded in AMBURAX and not yet posted to accounting."
          className="hidden items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-600/20 xl:inline-flex"
        >
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Accounting not connected
        </span>

        {props.canSell && (
          <Link
            href="/pos"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            <span aria-hidden="true">+</span>
            New Sale
            <kbd className="hidden rounded bg-blue-500 px-1 text-[10px] font-medium sm:inline">
              F2
            </kbd>
          </Link>
        )}

        <div className="flex items-center gap-2 border-l border-slate-200 pl-3">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600"
          >
            {props.userName.slice(0, 2).toUpperCase()}
          </span>
          <span className="hidden min-w-0 sm:block">
            <span className="block truncate text-sm font-medium text-slate-900">
              {props.userName}
            </span>
            <span className="block text-xs text-slate-500">{props.roleLabel}</span>
          </span>
          <button
            type="button"
            onClick={signOut}
            disabled={signingOut}
            className="rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </div>
    </header>
  );
}
