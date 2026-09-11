"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

type Phase =
  | { kind: "form" }
  | { kind: "submitted"; message: string; devResetLink?: string };

type FormError =
  | { kind: "validation"; message: string }
  | { kind: "rate_limited"; message: string }
  | { kind: "network"; message: string };

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError({ kind: "validation", message: "Enter your email address." });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/auth/password/reset-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (res.ok && data.status === "accepted") {
        setPhase({ kind: "submitted", message: data.message, devResetLink: data.devResetLink });
        return;
      }

      switch (data.error?.code) {
        case "validation_error":
          setError({ kind: "validation", message: data.error.message });
          break;
        case "rate_limited":
          setError({ kind: "rate_limited", message: data.error.message });
          break;
        case "service_unavailable":
          setError({ kind: "network", message: data.error.message });
          break;
        default:
          setError({ kind: "network", message: data.error?.message ?? "Something went wrong. Try again." });
      }
    } catch {
      setError({ kind: "network", message: "Can't reach the server. Check your connection and try again." });
    } finally {
      setSubmitting(false);
    }
  }

  if (phase.kind === "submitted") {
    return (
      <div className="mt-8 space-y-4">
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          {phase.message}
        </div>

        {phase.devResetLink && (
          <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800">
            DEV ONLY — no email provider is connected yet.{" "}
            <a href={phase.devResetLink} className="font-medium underline">
              Open the reset link
            </a>
          </div>
        )}

        <p className="text-sm text-slate-500">
          Didn&apos;t get it?{" "}
          <button
            type="button"
            onClick={() => setPhase({ kind: "form" })}
            className="font-medium text-brand-600 hover:text-brand-700"
          >
            Try another email
          </button>
        </p>

        <Link href="/auth/login" className="block text-center text-sm text-slate-500 hover:text-slate-700">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form className="mt-8 space-y-5" onSubmit={handleSubmit} noValidate>
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error.message}
        </div>
      )}

      <div>
        <label htmlFor="email" className="block text-sm font-medium text-slate-700">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          placeholder="you@business.com"
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="flex w-full items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Sending…" : "Send reset link"}
      </button>

      <Link href="/auth/login" className="block text-center text-sm text-slate-500 hover:text-slate-700">
        Back to sign in
      </Link>
    </form>
  );
}
