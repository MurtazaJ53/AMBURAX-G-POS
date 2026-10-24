"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X, Package, Barcode } from "lucide-react";
import { type StockLevel, type ProductVariant, type Product } from "@prisma/client";
import { StatusPill, type Status } from "./InventoryUI";
import { formatMinor } from "@/server/sales/saleTotals";
import { restoreInspectorFocus } from "./inspectorFocus";
import { BarcodeLabelModal } from "@/app/(app)/products/[id]/BarcodeLabelModal";

type DetailStock = StockLevel & {
  variant: ProductVariant & {
    product: Product;
  };
};

export function InventoryDetailPanel({
  item,
  closeHref,
  canManage,
}: {
  item: DetailStock;
  closeHref: string;
  canManage: boolean;
}) {
  const p = item.variant.product;
  const v = item.variant;
  const router = useRouter();
  const closeRef = useRef<HTMLAnchorElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  /**
   * Below `xl` this panel is a modal drawer over a backdrop; at `xl` and up it is a docked,
   * non-modal column beside the table. The DOM is the same in both, so whether it is modal is
   * decided here after mount. Starting `false` on both server and client keeps the first render
   * identical and avoids a hydration mismatch.
   */
  const [isOverlay, setIsOverlay] = useState(false);
  const [barcodeModalOpen, setBarcodeModalOpen] = useState(false);
  /**
   * The URL that failed to load, not a boolean. Changing rows does not remount this panel, so a
   * plain `failed` flag set by one product's broken image would wrongly hide the next product's
   * working one. Comparing against the current URL makes the fallback per-image.
   */
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1279.98px)");
    const sync = () => setIsOverlay(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  /**
   * Opening the drawer moves focus into it.
   *
   * The panel renders after the whole table in DOM order, so without this a keyboard user on a
   * phone or tablet had to Tab past every row — measured at 81 stops — through content that is
   * covered by the backdrop, before reaching the panel actually on screen. Docked on desktop the
   * panel is not modal and focus is left where the user put it.
   */
  useEffect(() => {
    if (isOverlay) closeRef.current?.focus();
  }, [isOverlay, v.sku]);

  /**
   * Closing hands focus back to the product that opened the panel.
   *
   * Every close path is a navigation that unmounts this panel, taking the focused Close link
   * with it, so the hand-back runs on unmount — after the re-rendered rows are in the DOM — and
   * reads the SKU shown last, so switching products while open restores to the latest one.
   * `restoreInspectorFocus` leaves focus alone when the user has it somewhere real (a filter
   * or pagination change also unmounts the panel) and never targets a detached node. The
   * `isConnected` check skips React's development-only simulated unmount, where the panel is
   * still on screen.
   */
  const skuRef = useRef(v.sku);
  useEffect(() => {
    skuRef.current = v.sku;
  }, [v.sku]);
  useEffect(() => {
    const sku = skuRef;
    const panel = panelRef.current;
    return () => {
      const last = sku.current;
      requestAnimationFrame(() => {
        if (panel?.isConnected) return;
        restoreInspectorFocus(last);
      });
    };
  }, []);

  /**
   * Escape closes, in both modes, by navigating to the same href the close control uses — so
   * the URL, the server-rendered selection and this keyboard path cannot disagree.
   *
   * As an overlay, Tab also wraps inside the panel. Once `aria-modal` tells assistive technology
   * the page behind is inert, letting keyboard focus walk out onto that covered content would
   * make the two disagree — measured before this, the Tab after "Adjust Stock" landed on a
   * "View All" link hidden under the backdrop. Docked on desktop the panel is not modal, so
   * nothing is wrapped there.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        router.push(closeHref);
        return;
      }
      if (e.key !== "Tab" || !isOverlay || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panelRef.current.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panelRef.current.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, closeHref, isOverlay]);

  const st: Status = item.quantity > 10 ? "In Stock" : item.quantity > 0 ? "Low Stock" : item.quantity < 0 ? "Negative" : "Out of Stock";

  const currency = (value: number) => formatMinor(value);

  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @media (prefers-reduced-motion: reduce) {
          .anim-fade { animation: none !important; }
          .anim-slide { animation: none !important; }
        }
        .anim-fade { animation: fadeIn 0.2s ease-out forwards; }
        .anim-slide { animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .anim-none { animation: none !important; }
      `}} />

      {/* Mobile Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40 xl:hidden anim-fade" aria-hidden="true">
        <Link href={closeHref} className="absolute inset-0 block" tabIndex={-1} prefetch={false} />
      </div>

      {/*
        Panel.

        Docked at `xl` it is `sticky`, `self-start` and capped to the viewport. It used to be
        `static` + `h-full` inside a grid whose single row is as tall as the table, and grid items
        stretch: measured at 1536x1024 the panel grew to 2385px, its body never scrolled, and
        "View Stock History" / "Adjust Stock" sat at y=2846 — about 1800px below the fold, with
        no way to see them and the panel header at the same time. `self-start` stops the stretch,
        the max-height bounds it, and the existing flex column (fixed header, `flex-1 min-h-0`
        scrolling body, fixed footer) then behaves as designed. `top-[84px]` clears the 68px
        sticky app header plus 16px.
      */}
      <aside
        ref={panelRef}
        className="fixed inset-y-0 right-0 z-50 flex w-[90%] max-w-[380px] flex-col overflow-hidden bg-background-card shadow-2xl anim-slide xl:sticky xl:top-[84px] xl:self-start xl:max-h-[calc(100vh-100px)] xl:w-[380px] xl:max-w-none xl:rounded-[8px] xl:border xl:border-border xl:shadow-sm xl:anim-none"
        aria-label="Product details"
        aria-modal={isOverlay || undefined}
        role="dialog"
      >
        <div className="flex shrink-0 items-start justify-between border-b border-border bg-slate-50 p-4">
          <div>
            <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-secondary">Selected product</div>
            <h2 className="text-sm font-bold text-primary">Product Details</h2>
          </div>
          <Link
            ref={closeRef}
            href={closeHref}
            prefetch={false}
            className="flex h-7 w-7 items-center justify-center rounded-md text-secondary transition-colors hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Close details"
          >
            <X className="h-4 w-4" />
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0 bg-white">
          <div className="flex gap-4 border-b border-border p-4">
            <div className="flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[5px] bg-slate-100 border border-slate-200">
              {/*
                Falls back on a failed load as well as on a missing URL. A product can carry an
                `imageUrl` whose file is absent — CCB-001 points at a JPEG that 404s — and the
                browser then painted the alt text "Casual Crossbody Bag" spilling out of this
                64x80 box. `key` gives each URL a fresh element so a new product's image always
                gets its own load attempt.
              */}
              {p.imageUrl && failedSrc !== p.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={p.imageUrl}
                  /*
                    `onError` alone misses one case. On a direct load of
                    `/inventory?selected=…` this <img> arrives in the server HTML and the browser
                    starts fetching it immediately; a fast 404 can fire before React hydrates and
                    attaches the handler, so the event is lost and the image stays broken. The
                    ref catches that on mount: `complete` with no `naturalWidth` means the load
                    already finished and failed.
                  */
                  ref={(el) => {
                    if (el && el.complete && el.naturalWidth === 0) setFailedSrc(p.imageUrl);
                  }}
                  src={p.imageUrl}
                  alt={p.name}
                  className="h-full w-full object-cover"
                  onError={() => setFailedSrc(p.imageUrl)}
                />
              ) : (
                <Package aria-hidden="true" className="h-6 w-6 text-slate-300" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[15px] font-bold leading-tight text-primary">{p.name}</h2>
              <div className="mt-1 truncate font-mono text-[11px] text-secondary">
                {v.sku} &bull; {p.brand || "No brand"}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <StatusPill status={st} />
              </div>
            </div>
          </div>

          <div className="p-4 text-[11px]">
            <div className="grid grid-cols-2 gap-x-2 gap-y-4">
              <div>
                <label className="block text-[10px] font-bold text-secondary mb-1">Category</label>
                <strong className="text-primary">{p.category || "None"}</strong>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-secondary mb-1">Brand</label>
                <strong className="text-primary">{p.brand || "None"}</strong>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-secondary mb-1">Sales Price</label>
                <strong className="font-mono text-primary text-[12px]">{currency(v.priceMinor)}</strong>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-secondary mb-1">Last updated</label>
                <strong className="text-primary">
                  {new Intl.DateTimeFormat("en-US", {
                    timeZone: "Asia/Kolkata",
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    hour12: true,
                  }).format(item.updatedAt)}
                </strong>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-2 rounded-lg border border-border bg-slate-50 p-3 text-center">
              <div>
                <label className="block text-[10px] font-bold text-secondary mb-1">Total Stock</label>
                <strong className="font-mono text-sm text-primary">{item.quantity}</strong>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-secondary mb-1">Available</label>
                <strong className="font-mono text-sm text-primary">{item.quantity}</strong>
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-t border-border bg-slate-50 p-4">
          <button
            type="button"
            onClick={() => setBarcodeModalOpen(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-[6px] border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] font-semibold text-sky-800 shadow-sm transition-colors hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Barcode className="h-3.5 w-3.5 text-sky-700" />
            Print Barcode &amp; Shelf Tag
          </button>

          <div className="flex gap-2">
            <Link
              href={`/inventory/movements?q=${encodeURIComponent(v.sku)}`}
              prefetch={false}
              className="flex flex-1 items-center justify-center rounded-[6px] border border-slate-300 bg-white px-3 py-2 text-[11px] font-semibold text-primary shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              View Stock History
            </Link>
            {canManage && (
              <Link
                href={`/inventory/adjustments/new?sku=${encodeURIComponent(v.sku)}`}
                prefetch={false}
                className="flex flex-1 items-center justify-center rounded-[6px] border border-transparent bg-primary px-3 py-2 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Adjust Stock
              </Link>
            )}
          </div>
        </div>
      </aside>

      {/* Mounted only while open, so the label count starts at 1 each time. */}
      {barcodeModalOpen && (
        <BarcodeLabelModal
          isOpen
          onClose={() => setBarcodeModalOpen(false)}
          variants={[
            {
              id: v.id,
              sku: v.sku,
              barcode: v.barcode,
              productName: p.name,
              size: v.size,
              colour: v.colour,
              priceMinor: v.priceMinor,
              mrpMinor: v.mrpMinor,
              quantity: 1,
            },
          ]}
        />
      )}
    </>
  );
}
