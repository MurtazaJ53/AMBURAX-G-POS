"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const BUSINESS_TYPES: { value: string; label: string }[] = [
  { value: "RETAIL", label: "Retail" },
  { value: "WHOLESALE", label: "Wholesale" },
  { value: "MANUFACTURING", label: "Manufacturing" },
  { value: "SERVICES", label: "Services" },
  { value: "DISTRIBUTION", label: "Distribution" },
  { value: "OTHER", label: "Other" },
];

interface FormState {
  businessName: string;
  businessType: string;
  industry: string;
  country: string;
  taxId: string;
  contactEmail: string;
  contactPhone: string;
  termsAccepted: boolean;
}

const initialState: FormState = {
  businessName: "",
  businessType: "RETAIL",
  industry: "",
  country: "",
  taxId: "",
  contactEmail: "",
  contactPhone: "",
  termsAccepted: false,
};

type FieldErrors = Partial<Record<keyof FormState, string>>;

type Banner =
  | { tone: "error"; message: string }
  | null;

type Phase = { kind: "form" } | { kind: "success"; businessName: string };

export function BusinessRegistrationForm() {
  const router = useRouter();
  // Stable for the life of this form mount — reused across retries of the same
  // submission (double-click, timeout-then-resubmit) so the backend can treat them
  // as one request instead of creating duplicate tenants. See registrationService.ts.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

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
    if (form.businessName.trim().length < 2) errors.businessName = "Enter your business name.";
    if (!form.country.trim()) errors.country = "Enter the country you operate in.";
    if (!/^\S+@\S+\.\S+$/.test(form.contactEmail)) errors.contactEmail = "Enter a valid email address.";
    if (form.contactPhone.trim().length < 7) errors.contactPhone = "Enter a valid phone number.";
    if (!form.termsAccepted) errors.termsAccepted = "You must accept the terms to continue.";
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
      const res = await fetch("/api/v1/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: form.businessName.trim(),
          businessType: form.businessType,
          industry: form.industry.trim() || undefined,
          country: form.country.trim(),
          taxId: form.taxId.trim() || undefined,
          contactEmail: form.contactEmail.trim(),
          contactPhone: form.contactPhone.trim(),
          termsAccepted: form.termsAccepted,
          idempotencyKey,
        }),
      });
      const data = await res.json();

      if (res.ok && data.status === "ok") {
        try {
          sessionStorage.setItem(
            "amburax_onboarding_session",
            JSON.stringify({ onboardingToken: data.onboardingToken, expiresAt: data.expiresAt }),
          );
        } catch {
          // sessionStorage can throw in locked-down browser contexts; onboarding can
          // still be resumed later via a fresh registration, so this is non-fatal.
        }
        setPhase({ kind: "success", businessName: data.businessName });
        router.push("/onboarding/owner");
        // Fallback in case client router transitions are delayed
        setTimeout(() => {
          if (window.location.pathname === "/onboarding/business") {
            window.location.href = "/onboarding/owner";
          }
        }, 1200);
        return;
      }

      switch (data.error?.code) {
        case "validation_error":
          setBanner({ tone: "error", message: data.error.message });
          break;
        case "rate_limited":
          setBanner({ tone: "error", message: data.error.message });
          break;
        case "service_unavailable":
          setBanner({ tone: "error", message: data.error.message });
          break;
        default:
          setBanner({ tone: "error", message: data.error?.message ?? "Registration failed. Try again." });
      }
    } catch {
      setBanner({ tone: "error", message: "Can't reach the server. Check your connection and try again." });
    } finally {
      setSubmitting(false);
    }
  }

  if (phase.kind === "success") {
    return (
      <div className="mt-8 space-y-4">
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          <span className="font-medium">{phase.businessName}</span> is registered. Taking you
          to owner account setup…
        </div>
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
        <legend className="sr-only">Business details</legend>

        <div>
          <label htmlFor="businessName" className="block text-sm font-medium text-slate-700">
            Business name
          </label>
          <input
            id="businessName"
            required
            value={form.businessName}
            onChange={(e) => update("businessName", e.target.value)}
            aria-invalid={!!fieldErrors.businessName}
            aria-describedby={fieldErrors.businessName ? "businessName-error" : undefined}
            className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            placeholder="Sharma Traders"
          />
          {fieldErrors.businessName && (
            <p id="businessName-error" className="mt-1 text-xs text-red-600">
              {fieldErrors.businessName}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="businessType" className="block text-sm font-medium text-slate-700">
              Business type
            </label>
            <select
              id="businessType"
              value={form.businessType}
              onChange={(e) => update("businessType", e.target.value)}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            >
              {BUSINESS_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="industry" className="block text-sm font-medium text-slate-700">
              Industry <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id="industry"
              value={form.industry}
              onChange={(e) => update("industry", e.target.value)}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              placeholder="Apparel, electronics…"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="country" className="block text-sm font-medium text-slate-700">
              Country
            </label>
            <input
              id="country"
              required
              value={form.country}
              onChange={(e) => update("country", e.target.value)}
              aria-invalid={!!fieldErrors.country}
              aria-describedby={fieldErrors.country ? "country-error" : undefined}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              placeholder="India"
            />
            {fieldErrors.country && (
              <p id="country-error" className="mt-1 text-xs text-red-600">
                {fieldErrors.country}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="taxId" className="block text-sm font-medium text-slate-700">
              Tax ID / GSTIN <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id="taxId"
              value={form.taxId}
              onChange={(e) => update("taxId", e.target.value)}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              placeholder="22AAAAA0000A1Z5"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="contactEmail" className="block text-sm font-medium text-slate-700">
              Business email
            </label>
            <input
              id="contactEmail"
              type="email"
              required
              value={form.contactEmail}
              onChange={(e) => update("contactEmail", e.target.value)}
              aria-invalid={!!fieldErrors.contactEmail}
              aria-describedby={fieldErrors.contactEmail ? "contactEmail-error" : undefined}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              placeholder="business@example.com"
            />
            {fieldErrors.contactEmail && (
              <p id="contactEmail-error" className="mt-1 text-xs text-red-600">
                {fieldErrors.contactEmail}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="contactPhone" className="block text-sm font-medium text-slate-700">
              Business phone
            </label>
            <input
              id="contactPhone"
              type="tel"
              required
              value={form.contactPhone}
              onChange={(e) => update("contactPhone", e.target.value)}
              aria-invalid={!!fieldErrors.contactPhone}
              aria-describedby={fieldErrors.contactPhone ? "contactPhone-error" : undefined}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              placeholder="+91 98765 43210"
            />
            {fieldErrors.contactPhone && (
              <p id="contactPhone-error" className="mt-1 text-xs text-red-600">
                {fieldErrors.contactPhone}
              </p>
            )}
          </div>
        </div>

        <div>
          <label className="flex items-start gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={form.termsAccepted}
              onChange={(e) => update("termsAccepted", e.target.checked)}
              aria-invalid={!!fieldErrors.termsAccepted}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <span>I agree to the Terms of Service and Privacy Policy.</span>
          </label>
          {fieldErrors.termsAccepted && <p className="mt-1 text-xs text-red-600">{fieldErrors.termsAccepted}</p>}
        </div>

        <button
          type="submit"
          className="flex w-full items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Creating your workspace…" : "Continue"}
        </button>
      </fieldset>

      <p className="text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link href="/auth/login" className="font-medium text-brand-600 hover:text-brand-700">
          Sign in
        </Link>
      </p>
    </form>
  );
}
