"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type LoginError =
  | { kind: "validation"; message: string }
  | { kind: "invalid_credentials"; message: string }
  | { kind: "rate_limited"; message: string }
  | { kind: "account_locked"; message: string }
  | { kind: "account_disabled"; message: string }
  | { kind: "network"; message: string };

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<LoginError | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!email || !password) {
      setError({ kind: "validation", message: "Enter your email and password." });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, remember }),
      });

      const data = await res.json();

      if (res.ok && data.status === "ok") {
        router.push("/home");
        router.refresh();
        return;
      }

      if (res.ok && data.status === "mfa_required") {
        sessionStorage.setItem(
          "amburax_mfa_challenge",
          JSON.stringify({
            challengeToken: data.challengeToken,
            expiresAt: data.expiresAt,
            maskedDestination: data.maskedDestination,
            devCode: data.devCode,
          }),
        );
        router.push("/auth/verify");
        return;
      }

      switch (data.error?.code) {
        case "rate_limited":
          setError({ kind: "rate_limited", message: data.error.message });
          break;
        case "account_locked":
          setError({ kind: "account_locked", message: data.error.message });
          break;
        case "account_disabled":
          setError({ kind: "account_disabled", message: data.error.message });
          break;
        case "validation_error":
          setError({ kind: "validation", message: data.error.message });
          break;
        case "service_unavailable":
          setError({ kind: "network", message: data.error.message });
          break;
        default:
          setError({ kind: "invalid_credentials", message: data.error?.message ?? "Sign in failed." });
      }
    } catch {
      setError({ kind: "network", message: "Can't reach the server. Check your connection and try again." });
    } finally {
      setSubmitting(false);
    }
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

      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="block text-sm font-medium text-slate-700">
            Password
          </label>
          <Link href="/auth/forgot-password" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            Forgot password?
          </Link>
        </div>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
          placeholder="••••••••"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
        />
        Keep me signed in on this device
      </label>

      <button
        type="submit"
        disabled={submitting}
        className="flex w-full items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>

      <p className="text-center text-sm text-slate-500">
        New to AMBURAX?{" "}
        <Link href="/onboarding/business" className="font-medium text-brand-600 hover:text-brand-700">
          Register your business
        </Link>
      </p>
    </form>
  );
}
