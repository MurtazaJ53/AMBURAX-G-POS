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
 * Only the presentation changed when this screen took on the supplied design, and only the
 * presentation changed again when it was brought onto the AMBURAX shell's language. Every
 * decision that matters — what is sent, where it is sent, which answers mean what, and where the
 * browser goes afterwards — is the same code it was before, because it is the half that is
 * load-bearing: `/api/v1/auth/login` verifies the password, sets an HttpOnly session cookie the
 * browser never reads, and decides whether a second factor is required. Nothing here
 * authenticates anybody.
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

/**
 * One control height for the whole screen, expressed once.
 *
 * This screen used to run a 46px input above a 48px submit button beside a 44px secondary action
 * — three heights for three controls stacked directly on each other, none of them a token. The
 * authenticated shell's controls sit at about 40px (`TopBar`'s search field and its primary
 * button are both `py-2` on 14px text), and 40px is below the 44px minimum touch target.
 *
 * So: 44 where a finger is the input device, 40 from `lg` where a pointer is. That is one rule
 * rather than a compromise, it is applied to every control on the screen without exception, and
 * the desktop half of it is the shell's own measurement.
 */
const CONTROL_H = "h-11 lg:h-10";

/**
 * The focus ring, named from the token rather than from `blue-500`.
 *
 * `--color-border-focus` and `--color-primary` hold the same value today. They are still written
 * as two names because they answer two questions, and a future theme is allowed to answer them
 * differently.
 *
 * `ring-border-focus` is the utility Tailwind generates for `colors.border.focus` — nested colour
 * keys are flattened with a hyphen, so the token's name is `border-focus` and the ring utility
 * prefixes it.
 *
 * Note for whoever is tempted to write the arbitrary-value form instead: do not spell one out
 * anywhere in this file, including in prose. Tailwind scans raw file text, so a class named in a
 * comment is a class that gets generated, and the bracketed colour form emits a selector this
 * project's PostCSS pipeline cannot parse — which fails the whole stylesheet, not just the rule.
 */
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-border-focus focus-visible:ring-offset-2";

/**
 * The field chrome, in one place so the two inputs cannot drift apart.
 *
 * `rounded-md` is 8px in this config's token scale — the middle rung, and the one the shell uses
 * for controls. The screen previously ran `rounded-xl` (16px) on the fields, 16px on the submit,
 * 4px on one link and `rounded-full` on a badge: four radii and no ladder between them.
 *
 * The placeholder stays at `slate-400`. It is the one intentionally low-contrast string on this
 * screen, and it is a hint rather than content: darkening it to the body grey makes an empty
 * field look like a filled one, which is a worse failure than the one it fixes. Every persistent
 * string on the screen is `slate-500` or darker.
 */
const FIELD_CLASS =
  `${CONTROL_H} w-full rounded-md border border-slate-200 bg-white text-sm text-slate-800 ` +
  "placeholder:text-slate-400 transition-colors focus:border-border-focus " +
  "focus:outline-none focus:ring-2 focus:ring-border-focus " +
  "disabled:cursor-not-allowed disabled:bg-slate-50";

const LABEL_CLASS = "mb-1.5 block text-[13px] font-medium text-slate-700";

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
        router.push("/dashboard");
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
    <form className="space-y-4" onSubmit={handleSubmit} noValidate>
      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className={`flex items-start gap-3 rounded-md border px-4 py-3 text-[13px] ${TONES[error.kind].className}`}
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
        <label htmlFor="email" className={LABEL_CLASS}>
          Email
        </label>
        <div className="relative">
          {/*
            The glyph inherits `currentColor` now, so the wrapper sets the colour and the icon
            agrees with its field by construction rather than by two literals that happened to
            match.
          */}
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
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
            className={`${FIELD_CLASS} pl-10 pr-3`}
          />
        </div>
      </div>

      <div>
        <label htmlFor="password" className={LABEL_CLASS}>
          Password
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
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

            The button fills the field's own height — 44 on touch, 40 from `lg` — around an 18px
            glyph, so its hit area follows the control rule rather than carrying a fourth size of
            its own. An 18px tap target on the one control a person reaches for when they have
            mistyped their password is not a target at all.
          */}
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            className={`absolute right-0.5 top-1/2 flex ${CONTROL_H} w-11 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 transition-colors hover:text-slate-700 lg:w-10 ${FOCUS_RING}`}
          >
            <IconEye open={showPassword} />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        {/*
          A real checkbox, visually replaced rather than reimplemented: the native input carries
          the state, the keyboard focus and the accessible name, and the square beside it is
          painted from `peer-checked`. A div with an onClick would have looked identical and been
          invisible to a keyboard.

          Checked by default, which is what this product did before the redesign and is a
          behavioural choice, not a visual one — the server reads `remember` to decide the session
          lifetime.
        */}
        <label className={`flex ${CONTROL_H} cursor-pointer select-none items-center gap-2`}>
          <input
            type="checkbox"
            checked={remember}
            disabled={submitting}
            onChange={(e) => setRemember(e.target.checked)}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className="flex size-4 items-center justify-center rounded-sm border border-slate-300 bg-white transition-colors peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-border-focus peer-focus-visible:ring-offset-2"
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
          {/*
            13px `slate-600`, which is this screen's secondary-text pair. It used to inherit the
            page's 16px and the page's `#1a1a2e` — a colour from no token file — while the two
            labels above it were 14px `slate-700`. The one control label a person reads last was
            also the one drawn in a different size and a different grey from every label above it.
          */}
          <span className="text-[13px] text-slate-600">Remember me</span>
        </label>

        {/* The same control rule as every other action on the screen. */}
        <Link
          href="/auth/forgot-password"
          className={`inline-flex ${CONTROL_H} shrink-0 items-center rounded-md text-[13px] font-semibold transition-opacity hover:opacity-80 ${FOCUS_RING}`}
          style={{ color: "var(--color-primary)" }}
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
        className={`flex ${CONTROL_H} w-full items-center justify-center gap-2 rounded-md bg-primary text-[13px] font-semibold text-white transition-colors hover:bg-primary-hover active:bg-primary-active disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
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
