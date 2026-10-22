"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PASSWORD_MIN_LENGTH } from "@/server/identity/passwordPolicy";

interface Props {
  token: string;
  email: string;
  accountExists: boolean;
  signedInAs: string | null;
}

type Banner = { message: string } | null;

export function AcceptInvitationForm({ token, email, accountExists, signedInAs }: Props) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [deadEnd, setDeadEnd] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBanner(null);

    if (!accountExists) {
      if (name.trim().length < 2) {
        setBanner({ message: "Enter your full name." });
        return;
      }
      if (password !== confirmPassword) {
        setBanner({ message: "Passwords do not match." });
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          accountExists ? { token } : { token, name: name.trim(), password, confirmPassword },
        ),
      });
      const data = await res.json();

      if (res.ok && data.status === "ok") {
        // Navigating away is also how the token leaves the address bar and history entry —
        // it's consumed and useless by now, and no /invite route exists to scrub to.
        router.push("/select-store");
        router.refresh();
        return;
      }

      switch (data.error?.code) {
        case "invitation_expired":
        case "invitation_revoked":
        case "invalid_invitation":
        case "invitation_already_accepted":
        case "identity_mismatch":
        case "identity_conflict":
        case "account_disabled":
        case "already_member":
        case "login_required":
          setDeadEnd(data.error.message);
          break;
        default:
          setBanner({ message: data.error?.message ?? "Something went wrong. Try again." });
      }
    } catch {
      setBanner({ message: "Can't reach the server. Check your connection and try again." });
    } finally {
      setSubmitting(false);
    }
  }

  // Someone is signed in, but not as the invited person. Blocked here for clarity and
  // blocked again server-side — the client check is UX only.
  if (signedInAs && signedInAs !== email) {
    return (
      <div className="mt-8 space-y-4">
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          This invitation was sent to <span className="font-medium">{email}</span>, but you&apos;re signed in as{" "}
          <span className="font-medium">{signedInAs}</span>. Sign out and open this link again.
        </div>
        <Link
          href="/dashboard"
          className="block w-full rounded-lg border border-slate-300 px-4 py-2.5 text-center text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          Go to your workspace
        </Link>
      </div>
    );
  }

  // Existing account, not signed in: identity must be proven by a real login, never by
  // possession of this link. Deliberately does not collect a password here — see
  // DECISIONS.md on why A11 never re-implements authentication.
  if (accountExists && !signedInAs) {
    return (
      <div className="mt-8 space-y-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          You already have an AMBURAX account for <span className="font-medium text-slate-800">{email}</span>. Sign
          in first, then open this invitation link again to accept it.
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

  if (deadEnd) {
    return (
      <div className="mt-8 space-y-4">
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {deadEnd}
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
      {banner && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {banner.message}
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        Joining as <span className="font-medium text-slate-800">{email}</span>
      </div>

      <fieldset disabled={submitting} className="space-y-5">
        <legend className="sr-only">Accept your invitation</legend>

        {!accountExists && (
          <>
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-slate-700">
                Full name
              </label>
              <input
                id="name"
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                placeholder="Priya Sharma"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700">
                Create a password
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
              <input
                id="confirmPassword"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1.5 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                placeholder="••••••••"
              />
            </div>
          </>
        )}

        <button
          type="submit"
          className="flex w-full items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Accepting…" : "Accept invitation"}
        </button>
      </fieldset>
    </form>
  );
}
