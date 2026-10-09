"use client";

import { useActionState, useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Download, Filter, Loader2, Phone, Plus, Search, Send, Upload, User, X } from "lucide-react";
import { createCustomerAction, type ActionState } from "./actions";
import { buttonClass } from "../_components/ui";

/* ----------------------------------------------------------- add customer */

/**
 * The add-customer dialog.
 *
 * A real modal: labelled, focus moves to the first field on open, Tab stays inside, Escape
 * and the backdrop close it, and focus goes back to the button that opened it. The form is
 * the same server action as before — only the surface changed.
 */
export function CustomerCreateDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (message: string) => void;
}) {
  const [state, action, isPending] = useActionState<ActionState, FormData>(createCustomerAction, { status: "idle" });
  const dialogRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const handled = useRef<ActionState | null>(null);

  useEffect(() => {
    if (state.status === "success" && handled.current !== state) {
      handled.current = state;
      onCreated(state.message ?? "Customer added.");
      onClose();
    }
  }, [state, onClose, onCreated]);

  useEffect(() => {
    if (!open) return;
    nameRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = [
        ...dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), [href]"),
      ];
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const nameError = state.status === "error" && state.field === "name" ? state.message : null;
  const formError = state.status === "error" && !state.field ? state.message : null;

  // Portalled to <body>: the page header animates with a transform, and a transformed
  // ancestor would otherwise become the box this `fixed` overlay is positioned against.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div aria-hidden="true" className="cust-fade absolute inset-0 bg-primary/50 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-customer-title"
        aria-describedby="add-customer-desc"
        className="cust-dialog relative w-full max-w-md overflow-hidden rounded-t-2xl bg-background-card shadow-2xl sm:rounded-2xl"
      >
        <div aria-hidden="true" className="h-1 bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500" />
        <div className="flex items-start justify-between gap-4 px-6 pb-2 pt-5">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-subtle text-primary-active">
              <User className="h-5 w-5" />
            </span>
            <div>
              <h2 id="add-customer-title" className="text-[13px] font-semibold text-primary">Add customer</h2>
              <p id="add-customer-desc" className="text-[11px] text-secondary">They can be attached to bills straight away.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-tertiary transition-colors hover:bg-background-hover hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-border-focus"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form action={action} className="space-y-4 px-6 pb-6 pt-3">
          {formError && (
            <div role="alert" className="rounded-xl border border-danger-subtle bg-danger-subtle px-3 py-2.5 text-[11px] text-danger">
              {formError}
            </div>
          )}

          <div>
            <label htmlFor="cust-name" className="mb-1.5 block text-[11px] font-medium text-primary">
              Customer name <span className="text-danger" aria-hidden="true">*</span>
            </label>
            <div className="relative">
              <User aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tertiary" />
              <input
                ref={nameRef}
                id="cust-name"
                name="name"
                type="text"
                required
                autoComplete="off"
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? "cust-name-error" : undefined}
                className={`h-11 w-full rounded-xl border bg-background-card pl-9 pr-3 text-[11px] text-primary placeholder:text-tertiary transition-colors focus:outline-none focus:ring-4 ${nameError ? "border-danger focus:border-danger focus:ring-danger/20" : "border-border focus:border-border-focus focus:ring-border-focus"}`}
                placeholder="e.g. Priya Sharma"
              />
            </div>
            {nameError && (
              <p id="cust-name-error" className="mt-1.5 text-[10px] font-medium text-danger">
                {nameError}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="cust-phone" className="mb-1.5 block text-[11px] font-medium text-primary">
              Phone number <span className="font-normal text-tertiary">(optional)</span>
            </label>
            <div className="relative">
              <Phone aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tertiary" />
              <input
                id="cust-phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                aria-describedby="cust-phone-hint"
                className="h-11 w-full rounded-xl border border-border bg-background-card pl-9 pr-3 text-[11px] tabular-nums text-primary placeholder:text-tertiary transition-colors focus:border-border-focus focus:outline-none focus:ring-4 focus:ring-border-focus"
                placeholder="10-digit mobile"
              />
            </div>
            <p id="cust-phone-hint" className="mt-1.5 text-[10px] text-tertiary">
              Identifies them at the till. An existing number opens that customer instead of a duplicate.
            </p>
          </div>

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className={`${buttonClass("secondary")} h-10 rounded-xl`}>
              Cancel
            </button>
            <button type="submit" disabled={isPending} className={`${buttonClass("primary")} amb-press h-10 rounded-xl shadow-sm`}>
              {isPending ? (
                <>
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  Adding…
                </>
              ) : (
                <>
                  <Plus aria-hidden="true" className="h-4 w-4" />
                  Add customer
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

/* ---------------------------------------------------------------- actions */

export function CustomerActions({ variant = "crm" }: { variant?: "crm" | "khata" }) {
  const [open, setOpen] = useState(false);
  // A fresh dialog per opening, so a previous attempt's error is not waiting in it.
  const [openCount, setOpenCount] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => openerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  // The reference's header actions per screen. Only "Add Customer" has anything behind it;
  // the rest are drawn as the reference has them, disabled and labelled.
  const unavailable =
    variant === "khata"
      ? [{ label: "Send Reminder", title: "Reminders need the accounting sync (not connected yet)", icon: Send }]
      : [
          { label: "Import", title: "Import is not available yet", icon: Upload },
          { label: "Export", title: "Export is not available yet", icon: Download },
        ];
  const trailing =
    variant === "khata"
      ? [
          { label: "Export", title: "Export is not available yet", icon: Download, primary: false },
          { label: "New Khata", title: "Khata ledgers need the accounting sync (not connected yet)", icon: Plus, primary: true },
        ]
      : [];

  const ghost = "inline-flex h-10 cursor-not-allowed items-center gap-2 rounded-lg border border-border bg-background-card px-4 text-[13px] font-medium text-tertiary";

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {unavailable.map(({ label, title, icon: Icon }) => (
        <button key={label} type="button" disabled title={title} className={ghost}>
          <Icon aria-hidden="true" className="h-4 w-4" />
          {label}
          <span className="sr-only"> (not available yet)</span>
        </button>
      ))}
      <button
        ref={openerRef}
        type="button"
        onClick={() => {
          setOpenCount((n) => n + 1);
          setOpen(true);
        }}
        className={
          variant === "khata"
            ? "amb-press inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-background-card px-4 text-[13px] font-medium text-brand transition-colors hover:border-brand-hover hover:bg-brand-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            : "amb-press inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-5 text-[13px] font-semibold text-background-card shadow-sm shadow-brand/20 transition-colors hover:bg-brand-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        }
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
        Add Customer
      </button>
      {trailing.map(({ label, title, icon: Icon, primary }) => (
        <button
          key={label}
          type="button"
          disabled
          title={title}
          className={primary ? "inline-flex h-10 cursor-not-allowed items-center gap-2 rounded-lg bg-brand/40 px-5 text-[13px] font-semibold text-background-card" : ghost}
        >
          <Icon aria-hidden="true" className="h-4 w-4" />
          {label}
          <span className="sr-only"> (not available yet)</span>
        </button>
      ))}

      <CustomerCreateDialog key={openCount} open={open} onClose={close} onCreated={setToast} />

      {isClient &&
        createPortal(
          <div aria-live="polite" className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2">
            {toast && (
              <div className="cust-dialog flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-[11px] font-medium text-background-card shadow-xl">
                <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-success" />
                {toast}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

/* ---------------------------------------------------------------- toolbar */

const SEGMENTS = [
  { value: "", label: "All" },
  { value: "RETAIL", label: "Retail" },
  { value: "WHOLESALE", label: "Wholesale" },
  { value: "DISTRIBUTOR", label: "Distributor" },
] as const;

export function CustomerToolbar({
  initialQuery,
  initialType,
  total,
}: {
  initialQuery: string;
  initialType: string;
  total: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery);
  // Pending state for the debounced search below.
  const [isPending, startTransition] = useTransition();

  // The box follows the URL, so Back/Forward and "Clear filters" never leave stale text.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery(searchParams.get("q") ?? "");
  }, [searchParams]);

  function push(update: (p: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    update(params);
    params.delete("page");
    params.delete("selected");
    const qs = params.toString();
    router.push(qs ? `/customers?${qs}` : "/customers");
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    push((p) => (q ? p.set("q", q) : p.delete("q")));
  }

  /*
    Live search, 350ms — the same debounce the sales, inventory and catalogue boxes use, so
    every search field in the product behaves alike. This one previously did nothing at all
    until Enter was pressed.

    The comparison against the URL's current `q` is load-bearing: the effect above re-syncs
    `query` from `searchParams` on every navigation, so without it this would push the query
    it had just navigated to and loop. Enter still applies immediately.
  */
  useEffect(() => {
    const next = query.trim();
    if (next === (searchParams.get("q") ?? "")) return;
    const t = window.setTimeout(() => {
      startTransition(() => {
        push((p) => (next ? p.set("q", next) : p.delete("q")));
      });
    }, 350);
    return () => window.clearTimeout(t);
    // `push` is recreated each render but closes only over router and searchParams, both of
    // which are tracked here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchParams]);

  const tabs = [
    { label: "All Customers", active: true },
    { label: "Loyalty Members", active: false },
    { label: "Inactive Customers", active: false },
    { label: "Top Customers", active: false },
    { label: "Customer Groups", active: false },
  ];

  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <h2 id="customer-toolbar-title" tabIndex={-1} className="sr-only outline-none">
        Customers ({total.toLocaleString("en-IN")})
      </h2>
      {/* Only "All" has a backing query; the reference's other views are drawn, disabled. */}
      <div role="tablist" aria-label="Customer views" className="no-scrollbar flex min-w-0 gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.label}
            type="button"
            role="tab"
            aria-selected={t.active}
            disabled={!t.active}
            title={t.active ? undefined : `${t.label} — not available yet`}
            className={`relative h-11 shrink-0 whitespace-nowrap px-3 text-[13px] ${
              t.active
                ? "font-semibold text-brand after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:rounded-full after:bg-brand"
                : "cursor-not-allowed text-tertiary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-3 pb-1 sm:flex-none">
        <label htmlFor="customer-segment" className="sr-only">
          Segment
        </label>
        <select
          id="customer-segment"
          value={initialType}
          onChange={(e) => push((p) => (e.target.value ? p.set("customerType", e.target.value) : p.delete("customerType")))}
          className="h-10 w-full rounded-lg border border-border bg-background-card px-3 text-[11px] text-secondary focus:border-border-focus focus:outline-none focus:ring-4 focus:ring-border-focus sm:w-[146px]"
        >
          {SEGMENTS.map((seg) => (
            <option key={seg.label} value={seg.value}>
              {seg.value ? seg.label : "All Segments"}
            </option>
          ))}
        </select>

        <form role="search" onSubmit={handleSearch} className="relative w-full min-w-0 sm:w-[286px]">
          <label htmlFor="search-customers" className="sr-only">
            Search customers
          </label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tertiary" />
          <input
            id="search-customers"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, phone or email..."
            className="h-10 w-full rounded-lg border border-border bg-background-card pl-9 pr-9 text-[11px] text-primary placeholder:text-tertiary transition-colors hover:border-border focus:border-border-focus focus:outline-none focus:ring-4 focus:ring-border-focus [&::-webkit-search-cancel-button]:hidden"
          />
          {/* Sits left of the clear button, absolutely positioned so the field never resizes. */}
          {isPending && (
            <span aria-hidden="true" className="pointer-events-none absolute right-9 top-1/2 -translate-y-1/2">
              <span className="block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
            </span>
          )}
          <span className="sr-only" role="status" aria-live="polite">
            {isPending ? "Updating customer results" : ""}
          </span>
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                if (searchParams.get("q")) push((p) => p.delete("q"));
              }}
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-tertiary transition-colors hover:bg-background-hover hover:text-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-border-focus"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </form>

        <button
          type="button"
          disabled
          title="More filters are not available yet"
          className="hidden h-10 cursor-not-allowed items-center gap-2 rounded-lg border border-border bg-background-card px-4 text-[13px] font-medium text-tertiary lg:inline-flex"
        >
          <Filter aria-hidden="true" className="h-4 w-4" />
          More Filters
        </button>
      </div>
    </div>
  );
}


