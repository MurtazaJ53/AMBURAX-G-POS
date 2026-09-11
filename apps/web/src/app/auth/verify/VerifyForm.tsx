"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const OTP_LENGTH = 6;
const STORAGE_KEY = "amburax_mfa_challenge";
const RESEND_COOLDOWN_SECONDS = 30;

interface StoredChallenge {
  challengeToken: string;
  expiresAt: string;
  maskedDestination: string;
  devCode?: string;
}

type Phase =
  | { kind: "loading" }
  | { kind: "no_challenge" }
  | { kind: "ready" }
  | { kind: "dead_end"; reason: string };

type Banner =
  | { tone: "error"; message: string }
  | { tone: "info"; message: string }
  | null;

function readChallenge(): StoredChallenge | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredChallenge;
  } catch {
    return null;
  }
}

function writeChallenge(challenge: StoredChallenge) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(challenge));
}

function clearChallenge() {
  sessionStorage.removeItem(STORAGE_KEY);
}

export function VerifyForm() {
  const router = useRouter();
  const [challenge, setChallenge] = useState<StoredChallenge | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [secondsUntilExpiry, setSecondsUntilExpiry] = useState<number | null>(null);
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    const stored = readChallenge();
    if (!stored) {
      setPhase({ kind: "no_challenge" });
      return;
    }
    setChallenge(stored);
    setPhase({ kind: "ready" });
    inputRefs.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (!challenge) return;
    const tick = () => {
      const remaining = Math.max(0, Math.floor((new Date(challenge.expiresAt).getTime() - Date.now()) / 1000));
      setSecondsUntilExpiry(remaining);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [challenge]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [resendCooldown]);

  function focusIndex(i: number) {
    inputRefs.current[i]?.focus();
    inputRefs.current[i]?.select();
  }

  function handleDigitChange(index: number, value: string) {
    const clean = value.replace(/\D/g, "");
    if (!clean) {
      setDigits((prev) => {
        const next = [...prev];
        next[index] = "";
        return next;
      });
      return;
    }
    setDigits((prev) => {
      const next = [...prev];
      next[index] = clean[clean.length - 1] ?? "";
      return next;
    });
    if (index < OTP_LENGTH - 1) focusIndex(index + 1);
  }

  function handleKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      focusIndex(index - 1);
    } else if (e.key === "ArrowLeft" && index > 0) {
      focusIndex(index - 1);
    } else if (e.key === "ArrowRight" && index < OTP_LENGTH - 1) {
      focusIndex(index + 1);
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
    if (!text) return;
    e.preventDefault();
    setDigits((prev) => {
      const next = [...prev];
      for (let i = 0; i < OTP_LENGTH; i++) next[i] = text[i] ?? next[i] ?? "";
      return next;
    });
    focusIndex(Math.min(text.length, OTP_LENGTH - 1));
  }

  async function handleSubmit() {
    if (!challenge) return;
    const code = digits.join("");
    if (code.length !== OTP_LENGTH) {
      setBanner({ tone: "error", message: `Enter all ${OTP_LENGTH} digits.` });
      return;
    }

    setSubmitting(true);
    setBanner(null);
    try {
      const res = await fetch("/api/v1/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeToken: challenge.challengeToken, code }),
      });
      const data = await res.json();

      if (res.ok && data.status === "ok") {
        clearChallenge();
        router.push("/home");
        router.refresh();
        return;
      }

      switch (data.error?.code) {
        case "otp_incorrect":
          setBanner({
            tone: "error",
            message: `That code isn't right. ${data.error.attemptsRemaining} attempt${data.error.attemptsRemaining === 1 ? "" : "s"} remaining.`,
          });
          setDigits(Array(OTP_LENGTH).fill(""));
          focusIndex(0);
          break;
        case "otp_expired":
          setPhase({ kind: "dead_end", reason: "This code has expired. Request a new one below." });
          break;
        case "otp_too_many_attempts":
          clearChallenge();
          setPhase({ kind: "dead_end", reason: "Too many incorrect attempts. Please sign in again." });
          break;
        case "invalid_challenge":
          clearChallenge();
          setPhase({ kind: "dead_end", reason: "This verification session is no longer valid. Please sign in again." });
          break;
        case "rate_limited":
          setBanner({ tone: "error", message: "Too many attempts. Try again in a few minutes." });
          break;
        case "service_unavailable":
          setBanner({ tone: "error", message: data.error.message });
          break;
        default:
          setBanner({ tone: "error", message: data.error?.message ?? "Verification failed." });
      }
    } catch {
      setBanner({ tone: "error", message: "Can't reach the server. Check your connection and try again." });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend(channel: "SMS" | "WHATSAPP") {
    if (!challenge || resendCooldown > 0) return;
    setResending(true);
    setBanner(null);
    try {
      const res = await fetch("/api/v1/auth/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeToken: challenge.challengeToken, channel }),
      });
      const data = await res.json();

      if (res.ok && data.status === "ok") {
        const updated: StoredChallenge = {
          challengeToken: challenge.challengeToken,
          expiresAt: data.expiresAt,
          maskedDestination: data.maskedDestination,
          devCode: data.devCode,
        };
        writeChallenge(updated);
        setChallenge(updated);
        setDigits(Array(OTP_LENGTH).fill(""));
        setResendCooldown(RESEND_COOLDOWN_SECONDS);
        setBanner({ tone: "info", message: `New code sent via ${channel === "SMS" ? "SMS" : "WhatsApp"}.` });
        focusIndex(0);
        return;
      }

      switch (data.error?.code) {
        case "resend_cooldown":
          setResendCooldown(data.error.retryAfterSeconds);
          setBanner({ tone: "error", message: "Please wait before requesting another code." });
          break;
        case "resend_limit_reached":
          clearChallenge();
          setPhase({ kind: "dead_end", reason: "You've reached the resend limit. Please sign in again." });
          break;
        case "otp_expired":
        case "invalid_challenge":
          clearChallenge();
          setPhase({ kind: "dead_end", reason: "This verification session is no longer valid. Please sign in again." });
          break;
        case "rate_limited":
          setBanner({ tone: "error", message: "Too many resend requests. Try again later." });
          break;
        default:
          setBanner({ tone: "error", message: data.error?.message ?? "Couldn't resend the code." });
      }
    } catch {
      setBanner({ tone: "error", message: "Can't reach the server. Check your connection and try again." });
    } finally {
      setResending(false);
    }
  }

  if (phase.kind === "loading") {
    return <div className="mt-8 h-40 animate-pulse rounded-lg bg-slate-100" aria-hidden="true" />;
  }

  if (phase.kind === "no_challenge") {
    return (
      <div className="mt-8 space-y-4">
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          We couldn't find an active sign-in to verify. This can happen if you refreshed the page or the tab was
          closed.
        </div>
        <Link
          href="/auth/login"
          className="block w-full rounded-lg bg-brand-600 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
        >
          Back to sign in
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
          href="/auth/login"
          className="block w-full rounded-lg bg-brand-600 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
        >
          Back to sign in
        </Link>
      </div>
    );
  }

  const expired = secondsUntilExpiry === 0;

  return (
    <div className="mt-8 space-y-5">
      {challenge && (
        <p className="text-sm text-slate-500">
          We sent a code to <span className="font-medium text-slate-700">{challenge.maskedDestination}</span>.
        </p>
      )}

      {challenge?.devCode && (
        <div className="rounded-lg border border-dashed border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          DEV ONLY — no SMS/WhatsApp provider is connected yet. Code: <strong>{challenge.devCode}</strong>
        </div>
      )}

      {banner && (
        <div
          role="alert"
          aria-live="assertive"
          className={
            banner.tone === "error"
              ? "rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
              : "rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
          }
        >
          {banner.message}
        </div>
      )}

      {expired && (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This code has expired. Request a new one below.
        </div>
      )}

      <fieldset disabled={submitting || expired}>
        <legend className="sr-only">Enter the 6-digit verification code</legend>
        <div className="flex justify-between gap-2">
          {digits.map((digit, i) => (
            <input
              key={i}
              ref={(el) => {
                inputRefs.current[i] = el;
              }}
              type="text"
              inputMode="numeric"
              autoComplete={i === 0 ? "one-time-code" : "off"}
              maxLength={1}
              value={digit}
              aria-label={`Digit ${i + 1} of ${OTP_LENGTH}`}
              onChange={(e) => handleDigitChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              onPaste={handlePaste}
              className="h-12 w-11 rounded-lg border border-slate-300 text-center text-lg font-semibold text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:bg-slate-50"
            />
          ))}
        </div>
      </fieldset>

      {!expired && secondsUntilExpiry !== null && (
        <p className="text-xs text-slate-400">
          Code expires in {Math.floor(secondsUntilExpiry / 60)}:{String(secondsUntilExpiry % 60).padStart(2, "0")}
        </p>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting || expired || digits.some((d) => !d)}
        className="flex w-full items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Verifying…" : "Verify & Continue"}
      </button>

      <div className="flex items-center justify-center gap-3 text-sm">
        <button
          type="button"
          onClick={() => handleResend("SMS")}
          disabled={resending || resendCooldown > 0}
          className="font-medium text-brand-600 hover:text-brand-700 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          {resendCooldown > 0 ? `Resend via SMS (${resendCooldown}s)` : "Resend via SMS"}
        </button>
        <span className="text-slate-300">·</span>
        <button
          type="button"
          onClick={() => handleResend("WHATSAPP")}
          disabled={resending || resendCooldown > 0}
          className="font-medium text-brand-600 hover:text-brand-700 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          Resend via WhatsApp
        </button>
      </div>

      <Link href="/auth/login" className="block text-center text-sm text-slate-500 hover:text-slate-700">
        Back to sign in
      </Link>
    </div>
  );
}
