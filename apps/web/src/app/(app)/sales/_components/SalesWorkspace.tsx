"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Download,
  Filter,
  IndianRupee,
  MoreHorizontal,
  Package,
  Printer,
  Receipt,
  RefreshCcw,
  RotateCcw,
  Search,
  ShoppingCart,
  UserRound,
  X,
} from "lucide-react";

import { fetchSaleDetailAction } from "../actions";
import { formatMinor } from "@/server/sales/saleTotals";
import type { SalesPage, SalesSummary, SalesAnalytics, SaleDetail } from "@/server/sales/saleQueries";

/**
 * Sales & Transaction History, laid out as the Phase-2 reference: four headline cards, one row
 * of filters, underlined status tabs over a dense table with its pager, the selected bill in a
 * 290px panel beside it, and three analytics cards underneath.
 *
 * What the reference shows and this store cannot back is drawn disabled and labelled: returns,
 * exchanges and drafts have no model, the page size is fixed by the server, and there is one
 * store per session, so those controls exist but never pretend to filter.
 */

interface SalesWorkspaceProps {
  page: SalesPage;
  summary: SalesSummary;
  analytics: SalesAnalytics;
  carriedParams: Record<string, string | undefined>;
}

const PAGE_SIZE = 20;

function formatIst(value: Date | string, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }) {
  return new Intl.DateTimeFormat("en-IN", { ...opts, timeZone: "Asia/Kolkata" }).format(new Date(value));
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "COMPLETED"
      ? "border-success-subtle bg-success-subtle text-success"
      : status === "VOIDED"
        ? "border-danger-subtle bg-danger-subtle text-danger"
        : "border-warning-subtle bg-warning-subtle text-warning";
  const label = status === "COMPLETED" ? "Completed" : status === "VOIDED" ? "Voided" : status.toLowerCase();
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium capitalize ${tone}`}>
      {label}
    </span>
  );
}

function methodLabel(method: string | null): string {
  if (!method) return "—";
  if (method.includes("+") || method === "SPLIT") return "Split";
  return method === "UPI" ? "UPI" : method.charAt(0) + method.slice(1).toLowerCase();
}

/* ------------------------------------------------------------------ detail */

function SaleDetailBody({ detail }: { detail: SaleDetail }) {
  return (
    <div className="space-y-3.5 px-4 py-3.5">
      <div>
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-[17px] font-bold text-primary">{detail.billNumber}</p>
          <StatusPill status={detail.status} />
        </div>
        <p className="mt-0.5 text-[11px] text-secondary">{formatIst(detail.completedAt)}</p>
        <p className="text-[11px] text-secondary">Cashier: {detail.cashierName}</p>
      </div>

      <div className="flex items-center gap-3 border-y border-border py-3">
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary">
          <UserRound className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-primary">{detail.customer?.name ?? "Walk-in Customer"}</p>
          <p className="truncate text-[11px] tabular-nums text-secondary">{detail.customer?.phone ?? "No phone on this bill"}</p>
        </div>
      </div>

      <ul aria-label={`Items (${detail.items.length})`} className="space-y-2.5">
        {detail.items.map((item, i) => (
          <li key={item.id} className="cust-rise flex items-center gap-2.5" style={{ ["--i" as string]: i }}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-background-hover">
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <Package aria-hidden="true" className="h-4 w-4 text-disabled" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-medium text-primary">{item.name}</p>
              <p className="truncate text-[11px] tabular-nums text-tertiary">
                {formatMinor(item.unitPriceMinor)} × {item.quantity}
              </p>
            </div>
            <span className="shrink-0 text-[11px] font-semibold tabular-nums text-primary">{formatMinor(item.lineTotalMinor)}</span>
          </li>
        ))}
      </ul>

      <dl className="space-y-1 border-t border-border pt-3 text-[11px]">
        <div className="flex justify-between text-secondary">
          <dt>Subtotal</dt>
          <dd className="tabular-nums text-primary">{formatMinor(detail.subtotalMinor)}</dd>
        </div>
        {detail.discountMinor > 0 && (
          <div className="flex justify-between text-secondary">
            <dt>Discount</dt>
            <dd className="font-medium tabular-nums text-success">−{formatMinor(detail.discountMinor)}</dd>
          </div>
        )}
        <div className="flex justify-between text-secondary">
          <dt>Tax</dt>
          <dd className="tabular-nums text-primary">{formatMinor(detail.taxMinor)}</dd>
        </div>
        <div className="flex items-baseline justify-between pt-1.5">
          <dt className="text-[16px] font-bold text-primary">Total</dt>
          <dd className="text-[16px] font-bold tabular-nums text-primary">{formatMinor(detail.totalMinor)}</dd>
        </div>
      </dl>

      <section aria-labelledby="sd-pay">
        <h3 id="sd-pay" className="mb-1.5 text-[11px] text-secondary">
          Payment Method{detail.payments.length > 1 ? "s (split)" : ""}
        </h3>
        <ul className="space-y-2">
          {detail.payments.map((p, i) => (
            <li key={i} className="flex items-center justify-between gap-3 text-[11px]">
              <span className="flex min-w-0 items-center gap-2 text-secondary">
                <CreditCard aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0">
                  <span className="block font-medium">{methodLabel(p.method)}</span>
                  {p.reference && <span className="block truncate text-[11px] text-tertiary">Txn ID: {p.reference}</span>}
                </span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-primary">{formatMinor(p.amountMinor)}</span>
            </li>
          ))}
        </ul>
      </section>

      <p className="text-[11px] text-tertiary">
        Sync: <span className="font-medium text-secondary">{detail.erpSyncStatus.toLowerCase()}</span>
        {detail.erpInvoiceId ? ` (${detail.erpInvoiceId})` : ""}
      </p>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-3 px-4 py-4" aria-hidden="true">
      {[44, 52, 108, 84, 64].map((h, i) => (
        <div key={i} className="amb-skeleton rounded-lg bg-background-hover" style={{ height: h }} />
      ))}
    </div>
  );
}

/** Windowed page numbers: first, last, and a run around the current page. */
function pageWindow(page: number, count: number): (number | "gap")[] {
  const out: (number | "gap")[] = [];
  for (let n = 1; n <= count; n += 1) {
    if (n === 1 || n === count || Math.abs(n - page) <= 2) out.push(n);
    else if (out[out.length - 1] !== "gap") out.push("gap");
  }
  return out;
}

const KPI_TONES = {
  sky: "bg-primary-subtle text-primary",
  violet: "bg-info-subtle text-info",
  rose: "bg-danger-subtle text-danger",
  emerald: "bg-success-subtle text-success",
} as const;

function Kpi({ index, tone, icon, label, value, hint }: { index: number; tone: keyof typeof KPI_TONES; icon: React.ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="cust-rise flex min-w-0 items-center gap-4 rounded-xl border border-border bg-background-card px-4 py-3.5 shadow-sm xl:h-[95px]" style={{ ["--i" as string]: index }}>
      <span aria-hidden="true" className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${KPI_TONES[tone]}`}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[13px] text-secondary">{label}</p>
        <p className="truncate text-[22px] font-bold leading-tight tracking-tight text-primary tabular-nums">{value}</p>
        <p className="truncate text-[13px] text-tertiary">{hint}</p>
      </div>
    </div>
  );
}

const CONTROL =
  "h-10 rounded-lg border border-border bg-background-card px-3 text-[11px] text-secondary transition-colors hover:border-border focus:border-border-focus focus:outline-none focus:ring-4 focus:ring-border-focus";

/* --------------------------------------------------------------- workspace */

export function SalesWorkspace({ page, summary, analytics, carriedParams }: SalesWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [selectedId, setSelectedId] = useState<string | null>(page.rows[0]?.id ?? null);
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  // Below xl the panel is a drawer and opens only when asked; at xl it is docked and always shown.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isOverlay, setIsOverlay] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState(carriedParams.q ?? "");
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // Keep the selection valid when the page of rows changes (filter, paging).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedId((cur) => (cur && page.rows.some((r) => r.id === cur) ? cur : (page.rows[0]?.id ?? null)));
  }, [page.rows]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1279.98px)");
    const sync = () => setIsOverlay(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!selectedId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDetail(null);
      return;
    }
    let active = true;
    setLoading(true);
    setDetailError(false);
    fetchSaleDetailAction(selectedId)
      .then((d) => {
        if (!active) return;
        setDetail(d ?? null);
        setDetailError(!d);
      })
      .catch(() => {
        if (active) setDetailError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedId]);

  // The search box follows the URL (Back/Forward, Reset) …
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery(searchParams.get("q") ?? "");
  }, [searchParams]);

  const setParams = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v) next.set(k, v);
        else next.delete(k);
      }
      if (!("page" in updates)) next.delete("page");
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // … and pushes to it after a pause in typing, not on every keystroke.
  useEffect(() => {
    const current = searchParams.get("q") ?? "";
    if (query.trim() === current) return;
    const t = window.setTimeout(() => setParams({ q: query.trim() || null }), 350);
    return () => window.clearTimeout(t);
  }, [query, searchParams, setParams]);

  const showDrawer = isOverlay && drawerOpen;

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    requestAnimationFrame(() => openerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!showDrawer) return;
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [showDrawer, closeDrawer]);

  function select(id: string, opener: HTMLElement | null) {
    openerRef.current = opener;
    setSelectedId(id);
    setDrawerOpen(true);
  }

  const activeFilters = [carriedParams.q, carriedParams.method, carriedParams.from, carriedParams.to].filter(Boolean).length;
  const first = page.total === 0 ? 0 : (page.page - 1) * PAGE_SIZE + 1;
  const last = Math.min(page.page * PAGE_SIZE, page.total);
  const trendMax = Math.max(1, ...analytics.trend.map((t) => t.amountMinor));
  const mixTotal = analytics.paymentMix.reduce((a, b) => a + b.amountMinor, 0) || 0;
  const typeTotal = analytics.typeMix.reduce((a, b) => a + b.count, 0);
  const countOf = (status: string) => analytics.typeMix.find((t) => t.status === status)?.count ?? 0;
  const MIX_COLORS = ["#2563eb", "#8b5cf6", "#f59e0b", "#10b981"];
  const status = carriedParams.status ?? "";

  const tabs: { value: string | null; label: string; count: number | null }[] = [
    { value: "", label: "All Transactions", count: typeTotal },
    { value: "COMPLETED", label: "Sales", count: countOf("COMPLETED") },
    { value: null, label: "Returns", count: null },
    { value: null, label: "Exchanges", count: null },
    { value: null, label: "Drafts", count: null },
    { value: "VOIDED", label: "Voided", count: countOf("VOIDED") },
  ];

  const panelInner = (
    <>
      <div className="flex shrink-0 items-center justify-between px-4 pb-1 pt-3.5">
        <h2 id="sale-panel-title" className="text-[15px] font-bold text-primary">
          Transaction Details
        </h2>
        {isOverlay && (
          <button
            ref={closeRef}
            type="button"
            onClick={closeDrawer}
            aria-label="Close transaction details"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-tertiary hover:bg-background-hover hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-border-focus"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {loading && !detail ? (
          <DetailSkeleton />
        ) : detailError ? (
          <p role="alert" className="px-4 py-8 text-center text-[13px] text-secondary">
            This bill could not be loaded. Open it from the bill number instead.
          </p>
        ) : detail ? (
          <div key={detail.id} className="cust-fade">
            <SaleDetailBody detail={detail} />
          </div>
        ) : null}
      </div>
      {detail && (
        <div className="flex shrink-0 gap-2 border-t border-border px-4 py-3">
          <Link
            href={`/sales/${detail.id}`}
            className="amb-press inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-sky-200 bg-background-card px-3 text-[11px] font-semibold text-primary-active transition-colors hover:bg-primary-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            <Printer aria-hidden="true" className="h-4 w-4" />
            Print Bill
          </Link>
          <button
            type="button"
            disabled
            title="Returns and exchanges are not available yet"
            className="inline-flex h-9 min-w-0 flex-1 cursor-not-allowed items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-background-card px-2 text-[11px] font-semibold text-tertiary"
          >
            <RefreshCcw aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span className="truncate">Return / Exchange</span>
            <span className="sr-only"> (not available yet)</span>
          </button>
          <button
            type="button"
            disabled
            aria-label="More actions (not available yet)"
            className="flex h-9 w-9 shrink-0 cursor-not-allowed items-center justify-center rounded-lg border border-border text-tertiary"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      )}
    </>
  );

  return (
    <>
      {/* ------------------------------------------------------------ header */}
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[26px] font-bold tracking-tight text-primary">Sales &amp; Transaction History</h1>
          <p className="mt-0.5 text-[15px] text-tertiary">View, search and manage all your sales and transactions</p>
        </div>
        <button
          type="button"
          disabled
          title="Export is not available yet"
          className="inline-flex h-10 cursor-not-allowed items-center gap-2 rounded-lg border border-border bg-background-card px-4 text-[13px] font-medium text-tertiary"
        >
          <Download aria-hidden="true" className="h-4 w-4" />
          Export
          <span className="sr-only"> (not available yet)</span>
        </button>
      </header>

      {/* -------------------------------------------------------------- KPIs */}
      <section aria-label="Sales summary for the current filters" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi index={0} tone="sky" icon={<ShoppingCart className="h-6 w-6" />} label="Total Sales" value={formatMinor(summary.totalMinor)} hint="Matching the filters below" />
        <Kpi index={1} tone="violet" icon={<Receipt className="h-6 w-6" />} label="Total Bills" value={summary.billCount.toLocaleString("en-IN")} hint="Completed and voided" />
        <Kpi index={2} tone="rose" icon={<RotateCcw className="h-6 w-6" />} label="Awaiting Sync" value={summary.unpostedCount.toLocaleString("en-IN")} hint="Not yet in accounting" />
        <Kpi
          index={3}
          tone="emerald"
          icon={<IndianRupee className="h-6 w-6" />}
          label="Avg. Bill Value"
          value={summary.averageBillMinor !== null ? formatMinor(summary.averageBillMinor) : "—"}
          hint={summary.averageBillMinor !== null ? "Total ÷ bills" : "No bills yet"}
        />
      </section>

      {/* ----------------------------------------------------------- filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3 xl:flex-nowrap xl:gap-2 2xl:gap-3">
        <div className={`${CONTROL} flex min-w-0 shrink-0 items-center gap-2 px-3`}>
          <CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
          <label className="sr-only" htmlFor="sales-from">
            From date
          </label>
          <input
            id="sales-from"
            type="date"
            value={carriedParams.from ?? ""}
            onChange={(e) => setParams({ from: e.target.value || null })}
            className="w-[104px] bg-transparent text-[11px] text-secondary outline-none xl:w-[96px] 2xl:w-[104px]"
          />
          <span aria-hidden="true" className="text-tertiary">
            –
          </span>
          <label className="sr-only" htmlFor="sales-to">
            To date
          </label>
          <input
            id="sales-to"
            type="date"
            value={carriedParams.to ?? ""}
            onChange={(e) => setParams({ to: e.target.value || null })}
            className="w-[104px] bg-transparent text-[11px] text-secondary outline-none xl:w-[96px] 2xl:w-[104px]"
          />
        </div>

        <button
          type="button"
          onClick={() => setFiltersOpen((o) => !o)}
          aria-expanded={filtersOpen}
          aria-controls="sales-more-filters"
          className={`${CONTROL} inline-flex items-center gap-2 font-medium md:hidden`}
        >
          <Filter aria-hidden="true" className="h-4 w-4" />
          Filters
          {activeFilters > 0 && <span className="rounded-full bg-primary px-1.5 text-[11px] font-bold text-background-card">{activeFilters}</span>}
        </button>

        <div id="sales-more-filters" className={`${filtersOpen ? "flex" : "hidden"} w-full flex-wrap items-center gap-3 md:flex md:w-auto xl:shrink-0 xl:flex-nowrap xl:gap-2 2xl:gap-3`}>
          <select disabled aria-label="Store (one store per session)" title="Switch stores from the header" className={`${CONTROL} w-[120px] cursor-not-allowed text-tertiary xl:w-[104px] 2xl:w-[120px]`}>
            <option>All Stores</option>
          </select>
          <label htmlFor="sales-method" className="sr-only">
            Payment method
          </label>
          <select id="sales-method" value={carriedParams.method ?? ""} onChange={(e) => setParams({ method: e.target.value || null })} className={`${CONTROL} w-[150px] xl:w-[136px] 2xl:w-[150px]`}>
            <option value="">All Payment Modes</option>
            <option value="CASH">Cash</option>
            <option value="UPI">UPI</option>
            <option value="CARD">Card</option>
          </select>
          <label htmlFor="sales-type" className="sr-only">
            Transaction type
          </label>
          <select id="sales-type" value={status} onChange={(e) => setParams({ status: e.target.value || null })} className={`${CONTROL} w-[166px] xl:w-[150px] 2xl:w-[166px]`}>
            <option value="">All Transaction Types</option>
            <option value="COMPLETED">Sales</option>
            <option value="VOIDED">Voided</option>
          </select>
        </div>

        <div className="relative min-w-0 flex-1 basis-60 xl:min-w-[120px] xl:basis-0">
          <label htmlFor="sales-search" className="sr-only">
            Search sales
          </label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tertiary" />
          <input
            id="sales-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") setParams({ q: query.trim() || null });
            }}
            placeholder="Search by bill no, customer, product..."
            className={`${CONTROL} w-full pl-9 pr-9 placeholder:text-tertiary [&::-webkit-search-cancel-button]:hidden`}
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                setParams({ q: null });
              }}
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-tertiary hover:bg-background-hover hover:text-secondary"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <button type="button" disabled title="More filters are not available yet" aria-label="More filters (not available yet)" className={`${CONTROL} hidden shrink-0 cursor-not-allowed items-center gap-2 px-3 text-[13px] font-medium text-tertiary lg:inline-flex 2xl:px-4`}>
          <Filter aria-hidden="true" className="h-4 w-4" />
          <span className="xl:hidden 2xl:inline">More Filters</span>
        </button>
        <button
          type="button"
          disabled={activeFilters === 0 && !status}
          onClick={() => {
            setQuery("");
            router.push(pathname, { scroll: false });
          }}
          className={`h-10 shrink-0 rounded-lg px-3 text-[13px] font-medium ${activeFilters === 0 && !status ? "cursor-default text-tertiary" : "text-primary-active hover:bg-primary-subtle"}`}
        >
          Reset
        </button>
      </div>

      {/* -------------------------------------------------- list + detail */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_290px]">
        <section aria-label="Transactions" className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background-card shadow-sm">
          <div role="tablist" aria-label="Transaction status" className="no-scrollbar flex gap-1 overflow-x-auto border-b border-border px-3">
            {tabs.map((t) => {
              const active = t.value !== null && status === t.value;
              return t.value === null ? (
                <button key={t.label} type="button" role="tab" aria-selected="false" disabled title={`${t.label} are not available yet`} className="h-11 shrink-0 cursor-not-allowed whitespace-nowrap px-3 text-[13px] text-tertiary">
                  {t.label}
                </button>
              ) : (
                <button
                  key={t.label}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setParams({ status: t.value || null })}
                  className={`relative h-11 shrink-0 whitespace-nowrap px-3 text-[13px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus ${
                    active
                      ? "font-semibold text-primary-active after:absolute after:inset-x-1 after:bottom-0 after:h-[2px] after:rounded-full after:bg-primary"
                      : "text-secondary hover:text-primary"
                  }`}
                >
                  {t.label} ({(t.count ?? 0).toLocaleString("en-IN")})
                </button>
              );
            })}
          </div>

          {page.rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-subtle text-primary">
                <Receipt className="h-5 w-5" />
              </span>
              <p className="mt-3 text-[11px] font-semibold text-primary">
                {activeFilters > 0 || status ? "No transactions match these filters" : "No sales yet"}
              </p>
              <p className="mt-1 max-w-xs text-[11px] text-secondary">
                {activeFilters > 0 || status ? "Try a wider date range or clear the filters." : "Bills completed at the till will appear here."}
              </p>
            </div>
          ) : (
            <>
              {/* Table from md up: fixed columns, never wider than its box; rows scroll inside. */}
              <div className="hidden px-3 pt-2 md:block">
                <div className="max-h-[max(300px,min(380px,calc(100dvh-420px)))] overflow-y-auto overflow-x-hidden overscroll-contain">
                  <table className="w-full table-fixed text-[11px]">
                    <caption className="sr-only">Transactions</caption>
                    <thead>
                      <tr className="text-left text-[11px] font-semibold text-secondary">
                        <th scope="col" className="sticky top-0 z-10 hidden w-9 rounded-l-md bg-background-subtle px-3 py-2.5 lg:table-cell">#</th>
                        <th scope="col" className="sticky top-0 z-10 w-[150px] bg-background-subtle px-2 py-2.5 first:rounded-l-md">Date &amp; Time</th>
                        <th scope="col" className="sticky top-0 z-10 w-[120px] bg-background-subtle px-2 py-2.5">Bill No.</th>
                        <th scope="col" className="sticky top-0 z-10 bg-background-subtle px-2 py-2.5">Customer</th>
                        <th scope="col" className="sticky top-0 z-10 hidden w-14 bg-background-subtle px-2 py-2.5 lg:table-cell">Items</th>
                        <th scope="col" className="sticky top-0 z-10 w-[92px] bg-background-subtle px-2 py-2.5">Amount</th>
                        <th scope="col" className="sticky top-0 z-10 hidden w-[96px] bg-background-subtle px-2 py-2.5 lg:table-cell">Payment Mode</th>
                        <th scope="col" className="sticky top-0 z-10 w-[92px] bg-background-subtle px-2 py-2.5">Status</th>
                        <th scope="col" className="sticky top-0 z-10 w-14 rounded-r-md bg-background-subtle px-2 py-2.5">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {page.rows.map((row, i) => {
                        const selected = row.id === selectedId;
                        return (
                          <tr
                            key={row.id}
                            aria-selected={selected}
                            onClick={(e) => select(row.id, (e.currentTarget.querySelector("button[data-preview]") as HTMLElement | null) ?? null)}
                            className={`cust-row cust-rise h-8 cursor-pointer border-b border-border ${selected ? "bg-primary-subtle/70" : "hover:bg-background-subtle"}`}
                            style={{ ["--i" as string]: i }}
                          >
                            <td className="hidden px-3 py-1.5 text-secondary lg:table-cell">{first + i}</td>
                            <td className="truncate px-2 py-1.5 text-secondary">
                              <time dateTime={new Date(row.completedAt).toISOString()}>{formatIst(row.completedAt)}</time>
                            </td>
                            <td className="truncate px-2 py-1.5">
                              <Link href={`/sales/${row.id}`} onClick={(e: React.MouseEvent) => e.stopPropagation()} className="text-primary-active hover:underline">
                                {row.billNumber}
                              </Link>
                            </td>
                            <td className="truncate px-2 py-1.5 text-primary">{row.customerName ?? "Walk-in Customer"}</td>
                            <td className="hidden px-2 py-1.5 tabular-nums text-secondary lg:table-cell">{row.itemsCount}</td>
                            <td className="truncate px-2 py-1.5 font-semibold tabular-nums text-primary">{formatMinor(row.totalMinor)}</td>
                            <td className="hidden truncate px-2 py-1.5 text-secondary lg:table-cell">{methodLabel(row.paymentMethod)}</td>
                            <td className="px-2 py-1.5">
                              <StatusPill status={row.status} />
                            </td>
                            <td className="px-2 py-1.5">
                              <button
                                type="button"
                                data-preview
                                aria-label={`View bill ${row.billNumber}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  select(row.id, e.currentTarget);
                                }}
                                className="rounded px-1 text-[11px] font-medium text-primary-active hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-border-focus"
                              >
                                View
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Cards below md. */}
              <ul className="divide-y divide-slate-100 md:hidden">
                {page.rows.map((row, i) => (
                  <li key={row.id} className="cust-rise" style={{ ["--i" as string]: i }}>
                    <button
                      type="button"
                      onClick={(e) => select(row.id, e.currentTarget)}
                      aria-label={`View bill ${row.billNumber}, ${formatMinor(row.totalMinor)}`}
                      className={`flex w-full items-center gap-3 px-4 py-3.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-border-focus ${row.id === selectedId ? "bg-primary-subtle/70" : "active:bg-background-subtle"}`}
                    >
                      <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-subtle text-primary">
                        <Receipt className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13px] font-semibold text-primary">{row.billNumber}</span>
                          <span className="shrink-0 text-[11px] font-semibold tabular-nums text-primary">{formatMinor(row.totalMinor)}</span>
                        </span>
                        <span className="mt-1 flex items-center justify-between gap-2 text-[10px] text-secondary">
                          <span className="truncate">
                            {row.customerName ?? "Walk-in"} · {formatIst(row.completedAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                          </span>
                          <StatusPill status={row.status} />
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>

              <div className="mt-auto flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <p className="text-[11px] text-secondary">
                  Showing {first}–{last} of {page.total.toLocaleString("en-IN")} transactions
                </p>
                <div className="flex items-center gap-3">
                  {page.pageCount > 1 && (
                    <nav aria-label="Pagination" className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label="Previous page"
                        disabled={page.page <= 1}
                        onClick={() => setParams({ page: String(page.page - 1) })}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-primary-active hover:bg-background-subtle disabled:cursor-not-allowed disabled:text-disabled"
                      >
                        <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                      </button>
                      {pageWindow(page.page, page.pageCount).map((n, idx) =>
                        n === "gap" ? (
                          <span key={`g${idx}`} className="w-6 text-center text-[11px] text-tertiary">
                            …
                          </span>
                        ) : (
                          <button
                            key={n}
                            type="button"
                            aria-current={n === page.page ? "page" : undefined}
                            aria-label={`Page ${n}`}
                            onClick={() => setParams({ page: String(n) })}
                            className={`h-8 min-w-8 rounded-md px-2 text-[11px] font-medium tabular-nums ${n === page.page ? "bg-primary text-background-card" : "text-secondary hover:bg-background-hover"}`}
                          >
                            {n}
                          </button>
                        ),
                      )}
                      <button
                        type="button"
                        aria-label="Next page"
                        disabled={page.page >= page.pageCount}
                        onClick={() => setParams({ page: String(page.page + 1) })}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-primary-active hover:bg-background-subtle disabled:cursor-not-allowed disabled:text-disabled"
                      >
                        <ChevronRight aria-hidden="true" className="h-4 w-4" />
                      </button>
                    </nav>
                  )}
                  <select disabled aria-label="Rows per page (fixed)" title="Page size is fixed at 20" className="h-8 cursor-not-allowed rounded-md border border-border bg-background-card px-2 text-[11px] text-tertiary">
                    <option>{PAGE_SIZE} / page</option>
                  </select>
                </div>
              </div>
            </>
          )}
        </section>

        {/* Docked panel at xl. */}
        {page.rows.length > 0 && !isOverlay && (
          <aside
            aria-labelledby="sale-panel-title"
            className="cust-drawer hidden min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background-card shadow-sm xl:flex"
          >
            {panelInner}
          </aside>
        )}
      </div>

      {/* Drawer below xl: a real dialog over a backdrop. */}
      {showDrawer && (
        <>
          <div aria-hidden="true" className="cust-fade fixed inset-0 z-40 bg-primary/45" onClick={closeDrawer} />
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="sale-panel-title"
            className="cust-drawer fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-background-card shadow-2xl sm:w-[380px]"
          >
            {panelInner}
          </aside>
        </>
      )}

      {/* ---------------------------------------------------------- analytics */}
      <section aria-label="Sales analytics" className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="cust-rise min-w-0 rounded-xl border border-border bg-background-card p-4 shadow-sm md:col-span-2 xl:col-span-1 xl:h-[210px]">
          <h2 className="text-[16px] font-bold text-primary">Sales Trend</h2>
          {analytics.trend.length === 0 ? (
            <p className="mt-12 text-center text-[13px] text-tertiary">No sales in this range</p>
          ) : (
            <div className="mt-3 flex h-[140px] gap-2">
              <div className="flex w-12 shrink-0 flex-col justify-between pb-4 text-right text-[10px] text-tertiary" aria-hidden="true">
                {[1, 0.5, 0].map((t) => (
                  <span key={t}>{t === 0 ? "0" : formatMinor(Math.round(trendMax * t)).replace(/\.00$/, "")}</span>
                ))}
              </div>
              <div
                className="flex min-w-0 flex-1 items-end gap-2 border-b border-border pb-0"
                role="img"
                aria-label={`Daily sales: ${analytics.trend.map((t) => `${t.label} ${formatMinor(t.amountMinor)}`).join(", ")}`}
              >
                {analytics.trend.map((t, i) => (
                  <div key={t.label} className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end">
                    <div
                      className="sales-bar w-full max-w-[26px] rounded-t bg-gradient-to-t from-sky-500 to-sky-300"
                      style={{ height: `${Math.max((t.amountMinor / trendMax) * 100, 3)}%`, ["--i" as string]: i }}
                      title={`${t.label}: ${formatMinor(t.amountMinor)}`}
                    />
                    <span className="absolute -bottom-4 w-full truncate text-center text-[10px] text-tertiary">{t.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="cust-rise min-w-0 rounded-xl border border-border bg-background-card p-4 shadow-sm xl:h-[210px]" style={{ ["--i" as string]: 1 }}>
          <h2 className="text-[16px] font-bold text-primary">Payment Mode Breakdown</h2>
          {analytics.paymentMix.length === 0 || mixTotal === 0 ? (
            <p className="mt-12 text-center text-[13px] text-tertiary">No payments in this range</p>
          ) : (
            <div className="mt-2 flex items-center gap-4">
              <PaymentDonut mix={analytics.paymentMix} total={mixTotal} colors={MIX_COLORS} />
              <ul className="min-w-0 flex-1 space-y-2.5 text-[11px]">
                {analytics.paymentMix.map((p, i) => (
                  <li key={p.method} className="flex items-center gap-2">
                    <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: MIX_COLORS[i % MIX_COLORS.length] }} />
                    <span className="w-10 truncate text-secondary">{methodLabel(p.method)}</span>
                    <span className="w-9 text-right text-tertiary">{Math.round((p.amountMinor / mixTotal) * 100)}%</span>
                    <span className="ml-auto truncate font-semibold tabular-nums text-primary">{formatMinor(p.amountMinor).replace(/\.00$/, "")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="cust-rise min-w-0 rounded-xl border border-border bg-background-card p-4 shadow-sm xl:h-[210px]" style={{ ["--i" as string]: 2 }}>
          <h2 className="text-[16px] font-bold text-primary">Transaction Type</h2>
          <ul className="mt-4 space-y-3.5 text-[11px]">
            {[
              { label: "Sales", count: countOf("COMPLETED"), color: "bg-primary", available: true },
              { label: "Returns", count: 0, color: "bg-danger-subtle0", available: false },
              { label: "Exchanges", count: 0, color: "bg-info-subtle0", available: false },
              { label: "Voided", count: countOf("VOIDED"), color: "bg-slate-400", available: true },
            ].map((t) => {
              const pct = typeTotal ? Math.round((t.count / typeTotal) * 1000) / 10 : 0;
              return (
                <li key={t.label} className={`grid grid-cols-[80px_44px_48px_minmax(0,1fr)] items-center gap-2 ${t.available ? "" : "opacity-60"}`}>
                  <span className="text-secondary">{t.label}</span>
                  <span className="text-right font-semibold tabular-nums text-primary">{t.available ? t.count : "—"}</span>
                  <span className="text-right tabular-nums text-tertiary">{t.available ? `${pct}%` : "n/a"}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-background-hover" title={t.available ? undefined : `${t.label} are not available yet`}>
                    {t.available && <span className={`sales-meter block h-full rounded-full ${t.color}`} style={{ width: `${Math.max(pct, 1)}%` }} />}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </section>
    </>
  );
}

function PaymentDonut({ mix, total, colors }: { mix: { method: string; amountMinor: number }[]; total: number; colors: string[] }) {
  // Circumference is 100, so dash lengths are percentages; each arc starts where the last ended.
  const arcs = mix.reduce<{ method: string; pct: number; offset: number }[]>((acc, p) => {
    const prev = acc[acc.length - 1];
    acc.push({ method: p.method, pct: (p.amountMinor / total) * 100, offset: prev ? prev.offset - prev.pct : 25 });
    return acc;
  }, []);
  return (
    <div className="relative size-[132px] shrink-0">
      <svg
        viewBox="0 0 42 42"
        className="inv-donut size-full"
        role="img"
        aria-label={`Payment split: ${mix.map((p) => `${methodLabel(p.method)} ${Math.round((p.amountMinor / total) * 100)}%`).join(", ")}`}
      >
        <circle cx="21" cy="21" r="15.915" fill="none" stroke="#f1f5f9" strokeWidth="6" />
        {arcs.map((arc, i) => (
          <circle key={arc.method} cx="21" cy="21" r="15.915" fill="none" stroke={colors[i % colors.length]} strokeWidth="6" strokeDasharray={`${arc.pct} ${100 - arc.pct}`} strokeDashoffset={arc.offset} />
        ))}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <strong className="text-[13px] font-bold tabular-nums text-primary">{formatMinor(total).replace(/\.00$/, "")}</strong>
        <span className="text-[10px] text-tertiary">Total Sales</span>
      </div>
    </div>
  );
}



