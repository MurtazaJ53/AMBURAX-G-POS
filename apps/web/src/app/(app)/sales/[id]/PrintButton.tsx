"use client";

import { useEffect } from "react";
import { Printer } from "lucide-react";

/**
 * Print this bill — `window.print()` with the bill page's print rules, and F3 does the same,
 * as the reference labels it. Deliberately the only working receipt action: e-mail, PDF export
 * and WhatsApp share appear in the design reference, have nothing behind them, and are shown
 * disabled beside this button rather than shipped as controls that silently do nothing.
 *
 * `variant="tile"` is the Actions-card form of the same button; only the header instance
 * registers the shortcut, so F3 never prints twice.
 */
export function PrintButton({ variant = "header" }: { variant?: "header" | "tile" }) {
  useEffect(() => {
    if (variant !== "header") return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "F3") return;
      event.preventDefault();
      window.print();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [variant]);

  return (
    <button
      type="button"
      onClick={() => window.print()}
      aria-keyshortcuts={variant === "header" ? "F3" : undefined}
      className="amb-press inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-border bg-background-card px-4 text-[13px] font-medium text-primary-active transition-colors hover:border-border-hover hover:bg-primary-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus print:hidden"
    >
      <Printer aria-hidden="true" className="h-4 w-4" />
      {variant === "header" ? "Print (F3)" : "Print Bill (F3)"}
    </button>
  );
}

