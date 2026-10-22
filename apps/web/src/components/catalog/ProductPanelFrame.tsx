"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * Where the product panel sits.
 *
 * At xl and up it is a docked third card beside the grid, as in the design reference. Below
 * that a third card would squeeze the grid to a sliver, so the same panel becomes a drawer
 * over the page — and a drawer is a modal: it traps Tab, closes on Escape or a click on the backdrop, locks the page
 * behind it, and hands focus back to the product card that opened it.
 *
 * Only one panel is ever mounted, so its tab ids stay unique and a screen reader never meets
 * a hidden twin.
 */

const OVERLAY_QUERY = "(max-width: 1279.98px)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(OVERLAY_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function ProductPanelFrame({
  productId,
  productName,
  closeHref,
  children,
}: {
  productId: string;
  productName: string;
  closeHref: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const frameRef = React.useRef<HTMLDivElement>(null);
  // Server render assumes docked; the client corrects on hydration without a layout effect.
  const overlay = React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(OVERLAY_QUERY).matches,
    () => false,
  );

  const close = React.useCallback(() => router.push(closeHref), [router, closeHref]);

  // Escape closes at every width; Tab is trapped only while the panel covers the page.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab" || !overlay || !frameRef.current) return;
      const focusable = [
        ...frameRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !frameRef.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !frameRef.current.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close, overlay]);

  // As a drawer: move focus in, and keep the page behind it still.
  React.useEffect(() => {
    if (!overlay) return;
    frameRef.current?.querySelector<HTMLElement>("[data-panel-close]")?.focus();
    const previous = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = previous;
    };
  }, [overlay, productId]);

  // On close, return focus to the card that opened the panel — after the navigation has
  // re-rendered the grid, which is why it waits a frame.
  React.useEffect(() => {
    return () => {
      const id = productId;
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active && active !== document.body && document.contains(active)) return;
        document.querySelector<HTMLElement>(`[data-product-id="${CSS.escape(id)}"]`)?.focus();
      });
    };
  }, [productId]);

  return (
    <>
      {overlay && (
        <div
          aria-hidden="true"
          onClick={close}
          className="amb-fade-in fixed inset-0 z-40 bg-slate-900/40"
        />
      )}
      <div
        ref={frameRef}
        role={overlay ? "dialog" : undefined}
        aria-modal={overlay ? true : undefined}
        aria-label={overlay ? `${productName} details` : undefined}
        className={
          overlay
            ? "cust-drawer fixed inset-y-0 right-0 z-50 flex w-full max-w-md shadow-2xl"
            : "pos-rise hidden min-h-0 w-[340px] shrink-0 overflow-hidden rounded-2xl border border-border bg-background-card shadow-sm xl:flex"
        }
      >
        {children}
      </div>
    </>
  );
}
