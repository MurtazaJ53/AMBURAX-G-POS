"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PASSWORD_MIN_LENGTH } from "@/server/identity/passwordPolicy";

const STORAGE_KEY = "amburax_onboarding_session";

interface StoredOnboarding {
  onboardingToken: string;
  expiresAt: string;
}

type Phase =
  | { kind: "loading" }
  | { kind: "no_session" }
  | { kind: "form"; onboardingToken: string }
  | { kind: "dead_end"; reason: string; cta: "register" | "login" };

type FormError =
  | { kind: "validation"; message: string }
  | { kind: "rate_limited"; message: string }
  | { kind: "network"; message: string };

function readOnboarding(): StoredOnboarding | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredOnboarding;
  } catch {
    return null;
  }
}

export function OwnerAccountForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<FormError | null>(null);

  useEffect(() => {
    // react-hooks/set-state-in-effect is suppressed on these two calls only.
    // Same constraint as VerifyForm: `readOnboarding()` reads sessionStorage, which is
    // absent during server rendering, so a lazy useState initializer would cause a
    // hydration mismatch. `phase` also transitions later (dead_end on a rejected
    // registration), so it cannot be replaced by a derived snapshot. Revisit with
    // useSyncExternalStore once this flow has component coverage.
    const stored = readOnboarding();
    if (!stored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above
      setPhase({ kind: "no_session" });
      return;
    }

    setPhase({ kind: "form", onboardingToken: stored.onboardingToken });
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (phase.kind !== "form") return;
    setError(null);

    const normalizedName = name.trim();
    const normalizedEmail = email.trim();

    if (!normalizedName) {
      setError({ kind: "validation", message: "Please enter your name." });
      return;
    }
    if (!normalizedEmail) {
      setError({ kind: "validation", message: "Please enter your email address." });
      return;
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      setError({ kind: "validation", message: "Please enter a valid email address." });
      return;
    }

    if (!password) {
      setError({ kind: "validation", message: "Please enter a password." });
      return;
    }
    if (password !== confirmPassword) {
      setError({ kind: "validation", message: "Passwords do not match." });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/onboarding/owner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          onboardingToken: phase.onboardingToken,
          name: normalizedName,
          email: normalizedEmail,
          password,
          confirmPassword,
        }),
      });
      const data = await res.json();

      if (res.ok && data.status === "ok") {
        try {
          sessionStorage.removeItem(STORAGE_KEY);
        } catch {
          // Non-fatal — the token is single-step-use via the server-side onboardingStep
          // claim regardless of whether the client manages to clear its own copy.
        }
        router.push("/onboarding/store");
        router.refresh();
        setTimeout(() => {
          if (window.location.pathname === "/onboarding/owner") {
            window.location.href = "/onboarding/store";
          }
        }, 1200);
        return;
      }

      switch (data.error?.code) {
        case "invalid_session":
          setPhase({ kind: "dead_end", reason: data.error.message, cta: "register" });
          break;
        case "already_completed":
          setPhase({ kind: "dead_end", reason: data.error.message, cta: "login" });
          break;
        case "weak_password":
        case "password_mismatch":
        case "email_taken":
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

  if (phase.kind === "no_session") {
    return (
      <div className="mt-8 space-y-4">
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          We couldn&apos;t find an in-progress business registration. This can happen if you
          refreshed the page or opened this link in a new tab.
        </div>
        <Link
          href="/onboarding/business"
          className="block w-full rounded-lg bg-brand-600 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
        >
          Register your business
        </Link>
      </div>
    );
  }

  if (phase.kind === "dead_end") {
    return (
      <div className="mt-8 space-y-4">
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {phase.reason}
        </div>
        <Link
          href={phase.cta === "login" ? "/auth/login" : "/onboarding/business"}
          className="block w-full rounded-lg bg-brand-600 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
        >
          {phase.cta === "login" ? "Sign in" : "Register your business"}
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
        <legend className="sr-only">Owner account details</legend>

        <div>
          <label htmlFor="name" className="block text-sm font-medium text-slate-700">
            Full name
          </label>
          <input
            id="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            placeholder="Priya Sharma"
          />
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            placeholder="you@business.com"
          />
          <p className="mt-1 text-xs text-slate-400">You&apos;ll sign in with this email.</p>
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-slate-700">
            Password
          </label>
          <div className="relative mt-1.5">
            <input
              id="password"
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
            Confirm password
          </label>
          <div className="relative mt-1.5">
            <input
              id="confirmPassword"
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
          {submitting ? "Creating your account…" : "Continue"}
        </button>
      </fieldset>
    </form>
  );
}
