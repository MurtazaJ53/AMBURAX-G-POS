"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BookOpen, CalendarDays, Mail, Pencil, Phone, ReceiptText, Send, ShoppingCart, StickyNote, X } from "lucide-react";
import { formatMinor } from "@/server/sales/saleTotals";
import { type CustomerDetail } from "@/server/sales/customers";
import { formatDateOnly } from "../sales/formatDateTime";
import { ActiveDot, CustomerAvatar, NotConnectedChip, SegmentPill } from "./customerUi";

const TABS = [
  { id: "history", label: "Purchase History", icon: ReceiptText },
  { id: "khata", label: "Khata", icon: BookOpen },
  { id: "notes", label: "Notes", icon: StickyNote },
] as const;
type TabId = (typeof TABS)[number]["id"];

/** The visible link that opened `id`'s panel — the table row or the mobile card, whichever is shown. */
function findOpener(id: string): HTMLElement | null {
  for (const a of document.querySelectorAll<HTMLAnchorElement>("a[href*='selected=']")) {
    if (a.closest("[data-customer-panel]") || a.getClientRects().length === 0) continue;
    const href = a.getAttribute("href") ?? "";
    const q = href.indexOf("?");
    if (q >= 0 && new URLSearchParams(href.slice(q + 1)).get("selected") === id) return a;
  }
  return null;
}

/**
 * The customer drawer.
 *
 * At `xl` it docks beside the directory and is not modal. Below that it is a dialog over a
 * backdrop: focus moves in, Tab stays in, the page behind does not scroll. Escape, the close
 * button and the backdrop all navigate to `closeHref`, which keeps the search, segment and
 * page the user came from, and focus is handed back to the row that opened it.
 */
export function CustomerDetailPanel({ detail, closeHref }: { detail: CustomerDetail; closeHref: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("history");
  const [isOverlay, setIsOverlay] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const close = () => router.push(closeHref, { scroll: false });

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1279.98px)");
    const sync = () => setIsOverlay(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Overlay: focus in and lock the page behind.
  useEffect(() => {
    if (!isOverlay) return;
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOverlay]);

  // Escape closes in both modes; Tab wraps only when modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        router.push(closeHref, { scroll: false });
        return;
      }
      if (e.key !== "Tab" || !isOverlay || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), [tabindex='0']")];
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

  // Hand focus back once the panel has gone, unless the user already put it somewhere real.
  useEffect(() => {
    const id = detail.id;
    const panel = panelRef.current;
    return () => {
      requestAnimationFrame(() => {
        if (panel?.isConnected) return;
        const active = document.activeElement;
        if (active && active !== document.body && active.isConnected) return;
        const opener = findOpener(id);
        if (opener) return opener.focus();
        document.getElementById("customer-toolbar-title")?.focus();
      });
    };
  }, [detail.id]);

  function onTabKey(e: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!delta && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next = e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : (index + delta + TABS.length) % TABS.length;
    setTab(TABS[next]!.id);
    tabRefs.current[next]?.focus();
  }

  const tabIndex = TABS.findIndex((t) => t.id === tab);
  const avgOrderMinor = detail.purchaseCount > 0 ? Math.round(detail.totalSpentMinor / detail.purchaseCount) : null;
  const hasTerms = detail.creditLimitMinor !== null || detail.paymentTermsDays !== null;

  return (
    <>
      {/* Server-rendered, hidden at xl by CSS, so the drawer never paints without its backdrop. */}
      <div aria-hidden="true" className="cust-fade fixed inset-0 z-40 bg-primary/45 xl:hidden" onClick={close} />

      <aside
        ref={panelRef}
        data-customer-panel
        role={isOverlay ? "dialog" : undefined}
        aria-modal={isOverlay || undefined}
        aria-labelledby="customer-dialog-title"
        className="cust-drawer fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-hidden bg-background-card shadow-2xl sm:w-[380px] xl:static xl:z-auto xl:w-auto xl:rounded-xl xl:border xl:border-border xl:shadow-sm"
      >
        <div className="flex shrink-0 items-center justify-between px-4 pb-1 pt-3.5">
          <h2 id="customer-dialog-title" className="text-[15px] font-bold text-primary">
            Customer Details
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            aria-label="Close customer details"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-tertiary transition-colors hover:bg-background-hover hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-border-focus"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {/* Identity */}
          <div className="flex items-start gap-3.5 px-4 pt-2">
            <CustomerAvatar id={detail.id} name={detail.name} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-[17px] font-semibold text-primary">{detail.name}</p>
                <Link
                  href={`/customers/${detail.id}`}
                  className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-sky-200 px-2 text-[11px] font-medium text-primary-active hover:bg-primary-subtle"
                >
                  <Pencil aria-hidden="true" className="h-3 w-3" />
                  Edit
                </Link>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <SegmentPill segment={detail.customerType} />
                <ActiveDot active={detail.isActive} />
              </div>
              <p className="mt-1 text-[11px] text-tertiary">Member since {formatDateOnly(detail.createdAt)}</p>
            </div>
          </div>

          {/* Contact */}
          <ul className="space-y-2 px-4 py-3.5 text-[11px] text-secondary">
            <li className="flex items-center gap-2.5">
              <Phone aria-hidden="true" className="h-4 w-4 shrink-0 text-tertiary" />
              {detail.phone ? (
                <a href={`tel:${detail.phone}`} className="tabular-nums hover:text-primary-active hover:underline">
                  {detail.phone}
                </a>
              ) : (
                <span className="text-tertiary">No phone</span>
              )}
            </li>
            <li className="flex items-center gap-2.5">
              <Mail aria-hidden="true" className="h-4 w-4 shrink-0 text-tertiary" />
              {detail.email ? (
                <a href={`mailto:${detail.email}`} className="truncate hover:text-primary-active hover:underline">
                  {detail.email}
                </a>
              ) : (
                <span className="text-tertiary">No email</span>
              )}
            </li>
            <li className="flex items-center gap-2.5">
              <CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0 text-tertiary" />
              Last purchase {detail.lastPurchaseAt ? formatDateOnly(detail.lastPurchaseAt) : "— never"}
            </li>
          </ul>

          {/* Figures */}
          <dl className="grid grid-cols-3 gap-2 px-4">
            {[
              { label: "Total Purchases", value: detail.purchaseCount.toLocaleString("en-IN") },
              { label: "Total Spend", value: formatMinor(detail.totalSpentMinor).replace(/\.00$/, "") },
              { label: "Avg. Order Value", value: avgOrderMinor !== null ? formatMinor(avgOrderMinor).replace(/\.00$/, "") : "—" },
            ].map((f, i) => (
              <div key={f.label} className="cust-rise min-w-0 rounded-lg border border-border px-2.5 py-2" style={{ ["--i" as string]: i }}>
                <dt className="truncate text-[11px] text-tertiary">{f.label}</dt>
                <dd className="mt-0.5 truncate text-[16px] font-bold tabular-nums text-primary">{f.value}</dd>
              </div>
            ))}
          </dl>

          {/* Tabs */}
          <div role="tablist" aria-label="Customer information" className="relative mx-4 mt-4 grid grid-cols-3 border-b border-border">
            <span
              aria-hidden="true"
              className="cust-tab-indicator absolute bottom-0 left-0 h-[2px] rounded-full bg-primary"
              style={{ width: `${100 / TABS.length}%`, transform: `translateX(${tabIndex * 100}%)` }}
            />
            {TABS.map((t, i) => {
              const selected = t.id === tab;
              return (
                <button
                  key={t.id}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  id={`cust-tab-${t.id}`}
                  role="tab"
                  type="button"
                  aria-selected={selected}
                  aria-controls={`cust-tabpanel-${t.id}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setTab(t.id)}
                  onKeyDown={(e) => onTabKey(e, i)}
                  className={`relative h-9 whitespace-nowrap text-[11px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus ${selected ? "font-semibold text-primary-active" : "text-secondary hover:text-primary"}`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <div
            key={tab}
            id={`cust-tabpanel-${tab}`}
            role="tabpanel"
            aria-labelledby={`cust-tab-${tab}`}
            className="cust-fade px-4 pb-4 pt-2"
          >
            {tab === "history" &&
              (detail.recentSales.length > 0 ? (
                <>
                  <table className="w-full table-fixed text-[11px]">
                    <caption className="sr-only">Recent purchases</caption>
                    <thead>
                      <tr className="text-left text-[11px] font-medium text-tertiary">
                        <th scope="col" className="rounded-l-md bg-background-subtle px-2 py-2">Date</th>
                        <th scope="col" className="bg-background-subtle px-2 py-2">Bill No.</th>
                        <th scope="col" className="rounded-r-md bg-background-subtle px-2 py-2 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.recentSales.map((sale, i) => (
                        <tr key={sale.id} className="cust-rise border-b border-border last:border-0" style={{ ["--i" as string]: i }}>
                          <td className="truncate px-2 py-2 text-secondary">
                            {sale.completedAt ? (
                              <time dateTime={new Date(sale.completedAt).toISOString()}>{formatDateOnly(new Date(sale.completedAt))}</time>
                            ) : (
                              "Not completed"
                            )}
                          </td>
                          <td className="truncate px-2 py-2">
                            <Link href={`/sales/${sale.id}`} className="text-primary-active hover:underline">
                              {sale.billNumber}
                            </Link>
                          </td>
                          <td className="px-2 py-2 text-right font-medium tabular-nums text-primary">{formatMinor(sale.totalMinor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Link
                    href={`/customers/${detail.id}`}
                    className="mt-2.5 flex items-center justify-end gap-1 text-[11px] font-medium text-primary-active hover:underline"
                  >
                    View Full Purchase History <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
                  </Link>
                </>
              ) : (
                <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
                  <ReceiptText aria-hidden="true" className="mx-auto h-6 w-6 text-slate-300" />
                  <p className="mt-2 text-[13px] font-medium text-primary">No sales yet</p>
                  <p className="mt-1 text-[11px] text-secondary">Bills attached to this customer at the till appear here.</p>
                </div>
              ))}

            {tab === "khata" && (
              <div className="space-y-3">
                <div className="rounded-lg border border-border bg-background-subtle p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-semibold text-primary">Outstanding balance</p>
                    <NotConnectedChip />
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-secondary">
                    Khata balances and payment history come from the accounting sync. Nothing is shown until it is
                    connected — never an estimate.
                  </p>
                </div>
                <div className="rounded-lg border border-border p-3">
                  <p className="text-[13px] font-semibold text-primary">Credit terms</p>
                  {hasTerms ? (
                    <dl className="mt-2 space-y-1.5 text-[11px]">
                      {detail.creditLimitMinor !== null && (
                        <div className="flex justify-between gap-3">
                          <dt className="text-secondary">Credit limit</dt>
                          <dd className="font-semibold tabular-nums text-primary">{formatMinor(detail.creditLimitMinor)}</dd>
                        </div>
                      )}
                      {detail.paymentTermsDays !== null && (
                        <div className="flex justify-between gap-3">
                          <dt className="text-secondary">Payment terms</dt>
                          <dd className="font-semibold text-primary">{detail.paymentTermsDays} days</dd>
                        </div>
                      )}
                    </dl>
                  ) : (
                    <p className="mt-1 text-[11px] text-secondary">No credit limit or payment terms agreed.</p>
                  )}
                </div>
              </div>
            )}

            {tab === "notes" && (
              <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
                <StickyNote aria-hidden="true" className="mx-auto h-6 w-6 text-slate-300" />
                <p className="mt-2 text-[13px] font-medium text-primary">Notes aren&apos;t set up</p>
                <p className="mt-1 text-[11px] text-secondary">Customer notes are not part of this release.</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 gap-2.5 border-t border-border bg-background-card p-4">
          <button
            type="button"
            disabled
            title="Offers are not available yet"
            className="inline-flex h-10 flex-1 cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-border bg-background-card text-[13px] font-medium text-tertiary"
          >
            <Send aria-hidden="true" className="h-4 w-4" />
            Send Offer
            <span className="sr-only"> (not available yet)</span>
          </button>
          <Link
            href="/pos"
            className="amb-press inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg bg-primary text-[13px] font-semibold text-background-card shadow-sm shadow-sm transition-colors hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            <ShoppingCart aria-hidden="true" className="h-4 w-4" />
            Create New Sale
          </Link>
        </div>
      </aside>
    </>
  );
}

