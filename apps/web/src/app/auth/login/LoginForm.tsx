"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  IconAlert,
  IconArrowRight,
  IconEnvelope,
  IconEye,
  IconLock,
  IconSpinner,
} from "./_components/icons";

/**
 * The sign-in form.
 *
 * Only the presentation changed when this screen took on the supplied design. Every decision that
 * matters — what is sent, where it is sent, which answers mean what, and where the browser goes
 * afterwards — is the same code it was before, because it is the half that is load-bearing:
 * `/api/v1/auth/login` verifies the password, sets an HttpOnly session cookie the browser never
 * reads, and decides whether a second factor is required. Nothing here authenticates anybody.
 *
 * The error union below mirrors the server's error codes rather than its prose. Matching on
 * `code` and not on `message` is deliberate: message text is copy, and copy changes.
 */

type LoginError =
  | { kind: "validation"; message: string }
  | { kind: "invalid_credentials"; message: string }
  | { kind: "rate_limited"; message: string }
  | { kind: "account_locked"; message: string }
  | { kind: "account_disabled"; message: string }
  | { kind: "network"; message: string };

/**
 * How each refusal is presented.
 *
 * The taxonomy is the server's and is untouched; this only decides what it looks like. Three
 * tones, chosen by what the person can do about it rather than by how bad it sounds:
 *
 *   amber   — wait or correct something, then try again
 *   red     — this will not succeed without someone else's involvement
 *   slate   — nothing was decided; the request did not get an answer
 *
 * The titles are ours and deliberately incurious: none of them reveals whether an account exists,
 * which is the whole reason `loginService` returns a single generic message for a bad email and a
 * bad password alike. The body is always the server's own words — we never write the detail.
 */
const TONES: Record<LoginError["kind"], { title: string; className: string }> = {
  validation: {
    title: "Check your details",
    className: "border-amber-200 bg-amber-50 text-amber-900",
  },
  invalid_credentials: {
    title: "Sign-in failed",
    className: "border-red-200 bg-red-50 text-red-800",
  },
  rate_limited: {
    title: "Too many attempts",
    className: "border-amber-200 bg-amber-50 text-amber-900",
  },
  account_locked: {
    title: "Account temporarily locked",
    className: "border-amber-200 bg-amber-50 text-amber-900",
  },
  account_disabled: {
    title: "Account disabled",
    className: "border-red-200 bg-red-50 text-red-800",
  },
  network: {
    title: "Couldn't reach the server",
    className: "border-slate-200 bg-slate-50 text-slate-700",
  },
};

/** The design's field chrome, in one place so the two inputs cannot drift apart. */
const FIELD_CLASS =
  "w-full rounded-xl border border-slate-200 bg-white py-3 text-sm text-slate-800 " +
  "placeholder:text-slate-500 transition-colors focus:border-transparent focus:outline-none " +
  "focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-slate-50";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<LoginError | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // The button is disabled while a sign-in is in flight, so this should be unreachable from a
    // mouse. It is not unreachable from Enter held down in a field, or from a submit event a
    // password manager fires. Two sign-in requests are not dangerous the way two sales are, but
    // the second one races the first one's redirect, and the loser shows an error for a sign-in
    // that actually worked.
    if (submitting) return;
    setError(null);

    const normalizedEmail = email.trim();

    if (!normalizedEmail && !password) {
      setError({ kind: "validation", message: "Please enter your email and password." });
      return;
    }
    if (!normalizedEmail) {
      setError({ kind: "validation", message: "Please enter your email address." });
      return;
    }
    if (!password) {
      setError({ kind: "validation", message: "Please enter your password." });
      return;
    }
    
    // Basic format check without being overly restrictive (let backend do deep validation)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      setError({ kind: "validation", message: "Please enter a valid email address." });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, password, remember }),
      });

      const data = await res.json();

      if (res.ok && data.status === "ok") {
        router.push("/select-store");
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
          setError({
            kind: "invalid_credentials",
            message: data.error?.message ?? "Sign in failed.",
          });
      }
    } catch {
      setError({
        kind: "network",
        message: "Can't reach the server. Check your connection and try again.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit} noValidate>
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className={`amb-pop-in flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${TONES[error.kind].className}`}
        >
          <IconAlert />
          <div>
            <p className="font-semibold">{TONES[error.kind].title}</p>
            <p className="mt-0.5 opacity-90">{error.message}</p>
          </div>
        </div>
      )}

      {/*
        Labelled "Email", not the design's "Email or Username". The endpoint validates the field
        with `z.string().email()` and rejects anything else as `validation_error`, so a username
        typed here can only ever fail. Inviting one would be a promise the server refuses to keep.
      */}
      <div>
        <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">
          Email
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2">
            <IconEnvelope />
          </span>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            disabled={submitting}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className={`${FIELD_CLASS} pl-10 pr-4`}
          />
        </div>
      </div>

      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">
          Password
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2">
            <IconLock />
          </span>
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            disabled={submitting}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            className={`${FIELD_CLASS} pl-10 pr-11`}
          />
          {/*
            The reveal toggle changes nothing but the input's `type`. The value never leaves this
            component, and the browser's own password manager keeps working because the field
            keeps its id, name and autocomplete across the switch.
          */}
          {/*
            A 44px square hit area around an 18px glyph. The icon lands where the design put it —
            the button is wider than it looks, not moved — and the field's `pr-11` still clears
            it. An 18px tap target on the one control a person reaches for when they have
            mistyped their password is not a target at all.
          */}
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg transition-opacity hover:opacity-70 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <IconEye open={showPassword} />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        {/*
          A real checkbox, visually replaced rather than reimplemented: the native input carries
          the state, the keyboard focus and the accessible name, and the square beside it is
          painted from `peer-checked`. A div with an onClick would have looked identical and been
          invisible to a keyboard.

          Checked by default, which is what this product did before the redesign and is a
          behavioural choice, not a visual one — the server reads `remember` to decide the session
          lifetime.
        */}
        <label className="flex min-h-[44px] cursor-pointer select-none items-center gap-2">
          <input
            type="checkbox"
            checked={remember}
            disabled={submitting}
            onChange={(e) => setRemember(e.target.checked)}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className="flex h-4 w-4 items-center justify-center rounded border-2 border-slate-300 bg-white transition-colors peer-checked:border-blue-600 peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 peer-focus-visible:ring-offset-2"
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path
                d="M2 6l3 3 5-5"
                stroke="white"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="text-sm text-slate-600">Remember me</span>
        </label>

        {/* Same 44px rule as the reveal toggle and the Create Account action. */}
        <Link
          href="/auth/forgot-password"
          className="inline-flex min-h-[44px] items-center rounded text-sm font-semibold text-blue-600 transition-colors hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Forgot password?
        </Link>
      </div>

      {/*
        `aria-busy` alongside the disabled state, because the two say different things: disabled
        says the control cannot be used, busy says why. The label changes as well, so the state is
        legible to someone who cannot see the spinner and to someone who cannot read the label.
      */}
      <button
        type="submit"
        disabled={submitting}
        aria-busy={submitting}
        className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-primary py-3.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 active:bg-primary-active disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? (
          <>
            <IconSpinner />
            Signing in…
          </>
        ) : (
          <>
            Sign In
            <IconArrowRight />
          </>
        )}
      </button>
    </form>
  );
}
