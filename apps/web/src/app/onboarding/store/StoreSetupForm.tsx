"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface FormState {
  name: string;
  code: string;
  storeType: "RETAIL" | "WAREHOUSE";
  currency: string;
  phone: string;
  addressLine: string;
  city: string;
  state: string;
  postalCode: string;
}

const initialState: FormState = {
  name: "",
  code: "",
  storeType: "RETAIL",
  currency: "INR",
  phone: "",
  addressLine: "",
  city: "",
  state: "",
  postalCode: "",
};

type FieldErrors = Partial<Record<keyof FormState, string>>;

type Banner = { tone: "error"; message: string } | null;

type Phase = { kind: "form" } | { kind: "dead_end"; reason: string };

export function StoreSetupForm() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(initialState);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [banner, setBanner] = useState<Banner>(null);
  const [submitting, setSubmitting] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (form.name.trim().length < 2) errors.name = "Enter a store name.";
    if (!/^[A-Za-z0-9]{2,10}$/.test(form.code.trim())) errors.code = "2-10 letters/numbers, no spaces.";
    if (!/^[A-Za-z]{3}$/.test(form.currency.trim())) errors.currency = "Use a 3-letter code, e.g. INR.";
    if (form.addressLine.trim().length < 3) errors.addressLine = "Enter the store address.";
    if (!form.city.trim()) errors.city = "Enter the city.";
    if (!form.state.trim()) errors.state = "Enter the state.";
    return errors;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBanner(null);

    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/stores", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          code: form.code.trim(),
          storeType: form.storeType,
          currency: form.currency.trim(),
          phone: form.phone.trim() || undefined,
          addressLine: form.addressLine.trim(),
          city: form.city.trim(),
          state: form.state.trim(),
          postalCode: form.postalCode.trim() || undefined,
        }),
      });
      const data = await res.json();

      if (res.ok && data.status === "ok") {
        router.push("/onboarding/team");
        router.refresh();
        return;
      }

      switch (data.error?.code) {
        case "unauthorized":
          router.push("/auth/login");
          return;
        case "already_completed":
          setPhase({ kind: "dead_end", reason: data.error.message });
          break;
        case "forbidden":
          setPhase({ kind: "dead_end", reason: data.error.message });
          break;
        case "validation_error":
        case "store_conflict":
          setBanner({ tone: "error", message: data.error.message });
          break;
        case "rate_limited":
          setBanner({ tone: "error", message: data.error.message });
          break;
        case "service_unavailable":
          setBanner({ tone: "error", message: data.error.message });
          break;
        default:
          setBanner({ tone: "error", message: data.error?.message ?? "Something went wrong. Try again." });
      }
    } catch {
      setBanner({ tone: "error", message: "Can't reach the server. Check your connection and try again." });
    } finally {
      setSubmitting(false);
    }
  }

  if (phase.kind === "dead_end") {
    return (
      <div className="mt-8 space-y-4">
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {phase.reason}
        </div>
        <Link
          href="/dashboard"
          className="block w-full rounded-lg bg-brand-600 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
        >
          Go to your workspace
        </Link>
      </div>
    );
  }

  return (
    <form className="mt-8 space-y-6" onSubmit={handleSubmit} noValidate>
      {banner && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {banner.message}
        </div>
      )}

      <fieldset disabled={submitting} className="space-y-6">
        <legend className="sr-only">Store details</legend>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-slate-700">
              Store name
            </label>
            <input
              id="name"
              required
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              aria-invalid={!!fieldErrors.name}
              aria-describedby={fieldErrors.name ? "name-error" : undefined}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              placeholder="Main Store"
            />
            {fieldErrors.name && (
              <p id="name-error" className="mt-1 text-xs text-red-600">
                {fieldErrors.name}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="code" className="block text-sm font-medium text-slate-700">
              Store code
            </label>
            <input
              id="code"
              required
              value={form.code}
              onChange={(e) => update("code", e.target.value.toUpperCase())}
              aria-invalid={!!fieldErrors.code}
              aria-describedby={fieldErrors.code ? "code-error" : undefined}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              placeholder="MAIN"
            />
            {fieldErrors.code && (
              <p id="code-error" className="mt-1 text-xs text-red-600">
                {fieldErrors.code}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="storeType" className="block text-sm font-medium text-slate-700">
              Store type
            </label>
            <select
              id="storeType"
              value={form.storeType}
              onChange={(e) => update("storeType", e.target.value as FormState["storeType"])}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            >
              <option value="RETAIL">Retail store</option>
              <option value="WAREHOUSE">Warehouse</option>
            </select>
          </div>

          <div>
            <label htmlFor="currency" className="block text-sm font-medium text-slate-700">
              Currency
            </label>
            <input
              id="currency"
              required
              value={form.currency}
              onChange={(e) => update("currency", e.target.value.toUpperCase())}
              aria-invalid={!!fieldErrors.currency}
              aria-describedby={fieldErrors.currency ? "currency-error" : undefined}
              maxLength={3}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              placeholder="INR"
            />
            {fieldErrors.currency && (
              <p id="currency-error" className="mt-1 text-xs text-red-600">
                {fieldErrors.currency}
              </p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="addressLine" className="block text-sm font-medium text-slate-700">
            Address
          </label>
          <input
            id="addressLine"
            required
            value={form.addressLine}
            onChange={(e) => update("addressLine", e.target.value)}
            aria-invalid={!!fieldErrors.addressLine}
            aria-describedby={fieldErrors.addressLine ? "addressLine-error" : undefined}
            className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            placeholder="123 MG Road"
          />
          {fieldErrors.addressLine && (
            <p id="addressLine-error" className="mt-1 text-xs text-red-600">
              {fieldErrors.addressLine}
            </p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label htmlFor="city" className="block text-sm font-medium text-slate-700">
              City
            </label>
            <input
              id="city"
              required
              value={form.city}
              onChange={(e) => update("city", e.target.value)}
              aria-invalid={!!fieldErrors.city}
              aria-describedby={fieldErrors.city ? "city-error" : undefined}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              placeholder="Bengaluru"
            />
            {fieldErrors.city && (
              <p id="city-error" className="mt-1 text-xs text-red-600">
                {fieldErrors.city}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="state" className="block text-sm font-medium text-slate-700">
              State
            </label>
            <input
              id="state"
              required
              value={form.state}
              onChange={(e) => update("state", e.target.value)}
              aria-invalid={!!fieldErrors.state}
              aria-describedby={fieldErrors.state ? "state-error" : undefined}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              placeholder="Karnataka"
            />
            {fieldErrors.state && (
              <p id="state-error" className="mt-1 text-xs text-red-600">
                {fieldErrors.state}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="postalCode" className="block text-sm font-medium text-slate-700">
              PIN <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id="postalCode"
              value={form.postalCode}
              onChange={(e) => update("postalCode", e.target.value)}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              placeholder="560001"
            />
          </div>
        </div>

        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-slate-700">
            Store phone <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id="phone"
            type="tel"
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
            className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            placeholder="+91 98765 43210"
          />
        </div>

        <button
          type="submit"
          className="flex w-full items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Creating your store…" : "Continue"}
        </button>
      </fieldset>
    </form>
  );
}
