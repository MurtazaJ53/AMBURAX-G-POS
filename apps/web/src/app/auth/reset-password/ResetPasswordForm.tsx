"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { validatePasswordStrength, PASSWORD_MIN_LENGTH } from "@/server/identity/passwordPolicy";

type Phase =
  | { kind: "loading" }
  | { kind: "no_token" }
  | { kind: "form"; token: string }
  | { kind: "dead_end"; reason: string }
  | { kind: "success" };

type FormError =
  | { kind: "validation"; message: string }
  | { kind: "rate_limited"; message: string }
  | { kind: "network"; message: string };

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<FormError | null>(null);

  useEffect(() => {
    const token = searchParams.get("token");
    // react-hooks/set-state-in-effect is suppressed on the two setPhase calls below, and
    // only here. This is the capture-then-destroy case: the very next statement calls
    // router.replace() to scrub the token out of the URL, so the token MUST be copied into
    // state first. Deriving `phase` from searchParams during render would be actively
    // wrong — the scrub empties searchParams, the derived token becomes null, and the form
    // would flip itself to "no_token" the instant it rendered. Tracked as a follow-up to
    // revisit with useSyncExternalStore once these flows have component coverage.
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above
      setPhase({ kind: "no_token" });
      return;
    }

    setPhase({ kind: "form", token });
    // Scrub the token out of the visible URL/history immediately after reading it — a
    // reset token has to arrive via a URL to be a clickable email link at all, but it
    // shouldn't keep sitting in the address bar/browser history/autocomplete longer than
    // the instant it takes to load this page.
    router.replace("/auth/reset-password", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (phase.kind !== "form") return;
    setError(null);

    if (password !== confirmPassword) {
      setError({ kind: "validation", message: "Passwords do not match." });
      return;
    }

    const strength = validatePasswordStrength(password);
    if (!strength.ok) {
      setError({ kind: "validation", message: strength.reason });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/auth/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: phase.token, password, confirmPassword }),
      });
      const data = await res.json();

      if (res.ok && data.status === "ok") {
        setPhase({ kind: "success" });
        return;
      }

      switch (data.error?.code) {
        case "invalid_token":
          setPhase({ kind: "dead_end", reason: "This reset link is invalid or has already been used." });
          break;
        case "expired_token":
          setPhase({ kind: "dead_end", reason: "This reset link has expired." });
          break;
        case "weak_password":
        case "password_mismatch":
        case "same_as_current":
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

  if (phase.kind === "loading") {
    return <div className="mt-8 h-40 animate-pulse rounded-lg bg-slate-100" aria-hidden="true" />;
  }

  if (phase.kind === "no_token" || phase.kind === "dead_end") {
    return (
      <div className="mt-8 space-y-4">
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {phase.kind === "dead_end" ? phase.reason : "This reset link is invalid."}
        </div>
        <Link
          href="/auth/forgot-password"
          className="block w-full rounded-lg bg-brand-600 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
        >
          Request a new link
        </Link>
        <Link href="/auth/login" className="block text-center text-sm text-slate-500 hover:text-slate-700">
          Back to sign in
        </Link>
      </div>
    );
  }

  if (phase.kind === "success") {
    return (
      <div className="mt-8 space-y-4">
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          Password updated. For your security, you&apos;ll need to sign in again on every device.
        </div>
        <Link
          href="/auth/login"
          className="block w-full rounded-lg bg-brand-600 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
        >
          Sign in
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

      <fieldset disabled={submitting} className="space-y-5">
        <legend className="sr-only">New password</legend>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700">
            New password
          </label>
          <div className="relative mt-1.5">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="block w-full rounded-lg border border-slate-300 px-3 py-2 pr-16 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-pressed={showPassword}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-slate-500 hover:text-slate-700"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            At least {PASSWORD_MIN_LENGTH} characters, with a letter and a number.
          </p>
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-slate-700">
            Confirm new password
          </label>
          <div className="relative mt-1.5">
            <input
              id="confirmPassword"
              name="confirmPassword"
              type={showConfirm ? "text" : "password"}
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="block w-full rounded-lg border border-slate-300 px-3 py-2 pr-16 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowConfirm((v) => !v)}
              aria-pressed={showConfirm}
              aria-label={showConfirm ? "Hide password" : "Show password"}
              className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-slate-500 hover:text-slate-700"
            >
              {showConfirm ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        <button
          type="submit"
          className="flex w-full items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Updating…" : "Reset password"}
        </button>
      </fieldset>

      <Link href="/auth/login" className="block text-center text-sm text-slate-500 hover:text-slate-700">
        Back to sign in
      </Link>
    </form>
  );
}
