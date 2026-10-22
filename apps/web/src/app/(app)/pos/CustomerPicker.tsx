"use client";

import { useEffect, useRef, useState } from "react";
import { BookOpen, Check, ChevronDown, Phone, Plus, Search, UserPlus, Users, X } from "lucide-react";
import { formatMinor } from "@/server/sales/saleTotals";
import { formatPhone, normalizeEmail, normalizeGstin, normalizeName, normalizePhone } from "@/lib/customerFields";

export interface CustomerHit {
  id: string;
  name: string;
  phone: string | null;
  /** Udhar owed on khata, in minor units. */
  dueMinor?: number;
  creditLimitMinor?: number | null;
  loyaltyPoints?: number;
}

export type PickerMode = "search" | "new";

type SearchState = { term: string; results: CustomerHit[]; error: string | null };
const EMPTY: SearchState = { term: "", results: [], error: null };

interface NewForm {
  phone: string;
  name: string;
  email: string;
  gstin: string;
  line1: string;
  city: string;
  postalCode: string;
}
const BLANK: NewForm = { phone: "", name: "", email: "", gstin: "", line1: "", city: "", postalCode: "" };

/**
 * The customer on this bill.
 *
 * Mobile number first, because that is how a counter identifies a person: the cashier asks for
 * the number, types it, and either the customer is already there (with what they owe on khata)
 * or a short form opens with the number already filled in. Every field is checked as it is
 * typed with the same rules the server applies (`@/lib/customerFields`), and the server still
 * has the last word — a number already on file returns that customer rather than a duplicate.
 */
export function CustomerPicker(props: {
  customer: CustomerHit | null;
  onChange: (customer: CustomerHit | null) => void;
  open: boolean;
  mode: PickerMode;
  onOpenChange: (open: boolean, mode?: PickerMode) => void;
}) {
  const { customer, onChange, open, mode, onOpenChange } = props;

  const [term, setTerm] = useState("");
  const [search, setSearch] = useState<SearchState>(EMPTY);
  const seq = useRef(0);

  const [form, setForm] = useState<NewForm>(BLANK);
  const [touched, setTouched] = useState<Partial<Record<keyof NewForm, boolean>>>({});
  const [moreOpen, setMoreOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<{ field: string | null; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [match, setMatch] = useState<{ phone: string; hit: CustomerHit } | null>(null);

  // ---- search ----------------------------------------------------------------------------
  useEffect(() => {
    const current = term.trim();
    if (!open || mode !== "search" || current.length === 0) return;
    const id = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/customers?q=${encodeURIComponent(current)}`);
        const data = await res.json();
        if (id !== seq.current) return;
        setSearch(
          res.ok
            ? { term: current, results: data.results as CustomerHit[], error: null }
            : { term: current, results: [], error: data?.error?.message ?? "Customer lookup failed." },
        );
      } catch {
        if (id === seq.current) setSearch({ term: current, results: [], error: "Customer lookup failed. Check the connection." });
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [term, open, mode]);

  const typed = term.trim();
  const settled = search.term === typed;
  const hits = typed && settled ? search.results : [];
  const searching = typed.length > 0 && !settled;
  const typedIsNumber = /^[+0-9 ()-]+$/.test(typed);

  // ---- new customer: live checks ------------------------------------------------------------
  const phoneCheck = normalizePhone(form.phone);
  const nameCheck = normalizeName(form.name);
  const emailCheck = normalizeEmail(form.email);
  const gstinCheck = normalizeGstin(form.gstin);
  const errors: Partial<Record<keyof NewForm, string>> = {
    phone: phoneCheck.ok ? undefined : phoneCheck.error,
    name: nameCheck.ok ? undefined : nameCheck.error,
    email: emailCheck.ok ? undefined : emailCheck.error,
    gstin: gstinCheck.ok ? undefined : gstinCheck.error,
  };
  const formValid = phoneCheck.ok && nameCheck.ok && emailCheck.ok && gstinCheck.ok;
  const validPhone = phoneCheck.ok ? phoneCheck.value : null;

  // The moment the number is complete, say whether it is already someone's — before the
  // cashier types a name for a person who already exists.
  useEffect(() => {
    if (!open || mode !== "new" || !validPhone) return;
    let live = true;
    const national = validPhone.replace(/\D/g, "").slice(-10);
    fetch(`/api/v1/customers?q=${encodeURIComponent(national)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!live || !data) return;
        const found = (data.results as CustomerHit[]).find((c) => (c.phone ?? "").replace(/\D/g, "").endsWith(national));
        setMatch(found ? { phone: validPhone, hit: found } : null);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [validPhone, open, mode]);
  // Only meaningful for the number currently typed.
  const existing = match && match.phone === validPhone ? match.hit : null;

  function close() {
    onOpenChange(false);
    setTerm("");
    setSearch(EMPTY);
    setForm(BLANK);
    setTouched({});
    setMoreOpen(false);
    setServerError(null);
    setMatch(null);
  }

  function pick(hit: CustomerHit) {
    onChange(hit);
    setNotice(null);
    close();
  }

  function startNew() {
    setForm({ ...BLANK, phone: typedIsNumber ? typed : "", name: typedIsNumber ? "" : typed });
    setTouched({});
    setServerError(null);
    setMatch(null);
    onOpenChange(true, "new");
  }

  async function save() {
    setTouched({ phone: true, name: true, email: true, gstin: true, line1: true, city: true, postalCode: true });
    if (!formValid || saving) return;
    setSaving(true);
    setServerError(null);
    try {
      const res = await fetch("/api/v1/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          phone: form.phone,
          email: form.email || null,
          gstin: form.gstin || null,
          address: form.line1 || form.city || form.postalCode ? {
            line1: form.line1,
            city: form.city,
            postalCode: form.postalCode,
          } : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setServerError({ field: data?.error?.field ?? null, message: data?.error?.message ?? "Could not add the customer." });
        return;
      }
      const saved = data.customer as CustomerHit;
      onChange(saved);
      setNotice(data.existing ? `${saved.name} was already saved with this number, so they were selected.` : null);
      close();
    } catch {
      setServerError({ field: null, message: "No connection. Try again." });
    } finally {
      setSaving(false);
    }
  }

  const fieldError = (key: keyof NewForm) =>
    serverError?.field === key
      ? serverError.message
      : touched[key] || (key !== "name" && key !== "phone" && form[key] !== "")
        ? errors[key]
        : undefined;

  // ---- selected ----------------------------------------------------------------------------
  if (customer && !open) {
    const initials = customer.name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
    const due = customer.dueMinor ?? 0;
    return (
      <div className="amb-fade-in">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-100 text-[11px] font-semibold text-sky-700 ring-1 ring-inset ring-sky-200">
            {initials || <Users className="h-4 w-4" />}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[13px] font-semibold text-slate-900" data-testid="pos-customer-name">{customer.name}</p>
            <p className="flex items-center gap-1.5 truncate text-[11px] tabular-nums text-slate-500">
              {customer.phone ? formatPhone(customer.phone) : <span className="text-amber-700">No mobile number</span>}
              {due > 0 ? (
                <span className="rounded-full bg-amber-100 px-1.5 py-px text-[10.5px] font-semibold text-amber-800" data-testid="pos-customer-due">
                  Udhar {formatMinor(due)}
                </span>
              ) : (
                <span className="rounded-full bg-emerald-50 px-1.5 py-px text-[10.5px] font-medium text-emerald-700">No due</span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(true, "search")}
            className="amb-press h-8 cursor-pointer rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600"
          >
            Change
          </button>
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setNotice(null);
            }}
            aria-label={`Remove ${customer.name} from this bill`}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
        {notice && (
          <p role="status" className="mt-1.5 rounded-md bg-sky-50 px-2 py-1 text-[11px] text-sky-800">
            {notice}
          </p>
        )}
      </div>
    );
  }

  // ---- walk-in -----------------------------------------------------------------------------
  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300 bg-white text-slate-500">
          <Users className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-[13px] font-semibold text-slate-800">Walk-in Customer</p>
          <p className="truncate text-[11px] text-slate-500">Add customer for loyalty, khata or GST</p>
        </div>
        <button
          type="button"
          onClick={() => onOpenChange(true, "search")}
          className="amb-press inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-2.5 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-600"
        >
          <Plus aria-hidden="true" className="h-3.5 w-3.5" />
          Add
        </button>
      </div>
    );
  }

  // ---- new customer form -------------------------------------------------------------------
  if (mode === "new") {
    const input =
      "h-9 w-full rounded-lg border bg-white px-3 text-[13px] text-slate-900 outline-none transition-colors placeholder:text-slate-500 focus:ring-4";
    const ok = "border-slate-300 focus:border-sky-500 focus:ring-sky-500/15";
    const bad = "border-rose-300 focus:border-rose-500 focus:ring-rose-500/15";
    const phoneErr = fieldError("phone");
    const nameErr = fieldError("name");
    const emailErr = fieldError("email");
    const gstinErr = fieldError("gstin");
    return (
      <form
        className="amb-fade-in space-y-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        aria-label="New customer"
      >
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-600">
            <UserPlus aria-hidden="true" className="h-3.5 w-3.5" /> New customer
          </p>
          <button type="button" onClick={close} className="cursor-pointer rounded-md px-1.5 py-0.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            Cancel
          </button>
        </div>

        <div>
          <label htmlFor="nc-phone" className="mb-1 block text-[11.5px] font-medium text-slate-700">
            Mobile number <span className="text-rose-600">*</span>
          </label>
          <div className="relative">
            <Phone aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              id="nc-phone"
              autoFocus={!form.phone}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              maxLength={16}
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value.replace(/[^\d+ ()-]/g, "") }))}
              onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
              placeholder="98765 43210"
              aria-invalid={phoneErr ? true : undefined}
              aria-describedby={phoneErr ? "nc-phone-err" : undefined}
              className={`${input} pl-8 tabular-nums ${phoneErr ? bad : ok}`}
            />
          </div>
          {phoneErr && <p id="nc-phone-err" className="mt-1 text-[11px] text-rose-600">{phoneErr}</p>}
          {!phoneErr && existing && (
            <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
              <span className="min-w-0 truncate">
                Already saved as <strong className="font-semibold">{existing.name}</strong>
                {(existing.dueMinor ?? 0) > 0 ? ` · udhar ${formatMinor(existing.dueMinor!)}` : ""}
              </span>
              <button type="button" onClick={() => pick(existing)} className="shrink-0 cursor-pointer rounded bg-white px-2 py-0.5 font-semibold text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100">
                Use
              </button>
            </div>
          )}
        </div>

        <div>
          <label htmlFor="nc-name" className="mb-1 block text-[11.5px] font-medium text-slate-700">
            Full name <span className="text-rose-600">*</span>
          </label>
          <input
            id="nc-name"
            autoFocus={!!form.phone}
            autoComplete="off"
            maxLength={80}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            onBlur={() => setTouched((t) => ({ ...t, name: true }))}
            placeholder="e.g. Priya Sharma"
            aria-invalid={nameErr ? true : undefined}
            aria-describedby={nameErr ? "nc-name-err" : undefined}
            className={`${input} ${nameErr ? bad : ok}`}
          />
          {nameErr && <p id="nc-name-err" className="mt-1 text-[11px] text-rose-600">{nameErr}</p>}
        </div>

        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
          className="flex cursor-pointer items-center gap-1 text-[11.5px] font-medium text-sky-700 hover:text-sky-900"
        >
          <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${moreOpen ? "rotate-180" : ""}`} />
          E-mail, GSTIN and Address (optional)
        </button>

        {moreOpen && (
          <div className="amb-fade-in space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
            <div className="grid grid-cols-2 gap-2">
              <div className="min-w-0">
                <label htmlFor="nc-email" className="mb-1 block text-[11px] font-medium text-slate-700">E-mail</label>
                <input
                  id="nc-email"
                  type="email"
                  autoComplete="off"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                  placeholder="name@mail.com"
                  aria-invalid={emailErr ? true : undefined}
                  className={`${input} ${emailErr ? bad : ok}`}
                />
                {emailErr && <p className="mt-1 text-[11px] text-rose-600">{emailErr}</p>}
              </div>
              <div className="min-w-0">
                <label htmlFor="nc-gstin" className="mb-1 block text-[11px] font-medium text-slate-700">GSTIN</label>
                <input
                  id="nc-gstin"
                  autoComplete="off"
                  maxLength={15}
                  value={form.gstin}
                  onChange={(e) => setForm((f) => ({ ...f, gstin: e.target.value.toUpperCase() }))}
                  onBlur={() => setTouched((t) => ({ ...t, gstin: true }))}
                  placeholder="27ABCDE1234F1Z5"
                  aria-invalid={gstinErr ? true : undefined}
                  className={`${input} uppercase ${gstinErr ? bad : ok}`}
                />
                {gstinErr && <p className="mt-1 text-[11px] text-rose-600">{gstinErr}</p>}
              </div>
            </div>

            <div className="border-t border-slate-200/60 pt-2 space-y-2">
              <div className="min-w-0">
                <label htmlFor="nc-line1" className="mb-1 block text-[11px] font-medium text-slate-700">Street Address</label>
                <input
                  id="nc-line1"
                  autoComplete="off"
                  value={form.line1}
                  onChange={(e) => setForm((f) => ({ ...f, line1: e.target.value }))}
                  placeholder="Shop / House / Road"
                  className={input}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="min-w-0">
                  <label htmlFor="nc-city" className="mb-1 block text-[11px] font-medium text-slate-700">City</label>
                  <input
                    id="nc-city"
                    autoComplete="off"
                    value={form.city}
                    onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                    placeholder="e.g. Mumbai"
                    className={input}
                  />
                </div>
                <div className="min-w-0">
                  <label htmlFor="nc-postal" className="mb-1 block text-[11px] font-medium text-slate-700">PIN Code</label>
                  <input
                    id="nc-postal"
                    autoComplete="off"
                    maxLength={16}
                    value={form.postalCode}
                    onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value.toUpperCase() }))}
                    placeholder="400001"
                    className={`${input} uppercase`}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {serverError && !serverError.field && (
          <p role="alert" className="rounded-md bg-rose-50 px-2 py-1 text-[11px] text-rose-700">{serverError.message}</p>
        )}

        <div className="flex gap-2 pt-0.5">
          <button
            type="button"
            onClick={() => onOpenChange(true, "search")}
            className="h-9 cursor-pointer rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Back
          </button>
          <button
            type="submit"
            disabled={saving}
            className="amb-press inline-flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Check aria-hidden="true" className="h-3.5 w-3.5" />
            {saving ? "Saving…" : "Save & add to bill"}
          </button>
        </div>
      </form>
    );
  }

  // ---- search ------------------------------------------------------------------------------
  return (
    <div className="amb-fade-in space-y-2">
      <div className="flex items-center justify-between">
        <label htmlFor="pos-customer-search" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Find customer
        </label>
        <button type="button" onClick={close} className="cursor-pointer rounded-md px-1.5 py-0.5 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800">
          Cancel
        </button>
      </div>
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <input
          id="pos-customer-search"
          autoFocus
          autoComplete="off"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && hits.length === 1) pick(hits[0]!);
            if (e.key === "Escape") close();
          }}
          placeholder="Mobile number or name…"
          className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-[13px] outline-none transition-colors focus:border-sky-500 focus:ring-4 focus:ring-sky-500/15"
        />
      </div>

      {searching && <p className="text-xs text-slate-500" aria-live="polite">Searching…</p>}
      {settled && search.error && <p role="alert" className="text-xs text-rose-600">{search.error}</p>}

      {hits.length > 0 && (
        <ul className="max-h-36 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white" aria-label="Matching customers">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                onClick={() => pick(hit)}
                className="flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-2 text-left text-[13px] transition-colors hover:bg-sky-50 focus-visible:bg-sky-50 focus-visible:outline-none"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-slate-800">{hit.name}</span>
                  <span className="block truncate text-[11px] tabular-nums text-slate-500">{hit.phone ? formatPhone(hit.phone) : "No mobile number"}</span>
                </span>
                {(hit.dueMinor ?? 0) > 0 && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold text-amber-800">
                    <BookOpen aria-hidden="true" className="h-3 w-3" />
                    {formatMinor(hit.dueMinor!)}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {typed.length > 0 && settled && !search.error && hits.length === 0 && (
        <p className="text-xs text-slate-600">No customer with {typedIsNumber ? "this number" : "this name"} yet.</p>
      )}

      <button
        type="button"
        onClick={startNew}
        className="amb-press flex h-9 w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-sky-300 bg-sky-50/70 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-100"
      >
        <UserPlus aria-hidden="true" className="h-3.5 w-3.5" />
        {typed && hits.length === 0 ? `Add "${typed}" as new customer` : "New customer"}
      </button>
    </div>
  );
}
