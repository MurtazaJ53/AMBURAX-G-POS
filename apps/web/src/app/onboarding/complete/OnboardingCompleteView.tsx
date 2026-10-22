"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { OnboardingReadiness, ReadinessItem, ReadinessLevel } from "@/server/onboarding/readiness";

interface Props {
  readiness: OnboardingReadiness;
}

// Presentation only. Every level, every detail sentence and both top-level booleans are
// computed server-side in readiness.ts — this component never decides whether something is
// ready, it only decides how to show what the server already concluded.
const LEVEL_STYLES: Record<ReadinessLevel, { chip: string; label: string; dot: string }> = {
  READY: { chip: "bg-emerald-50 text-emerald-700 border-emerald-200", label: "Ready", dot: "bg-emerald-500" },
  PENDING: { chip: "bg-amber-50 text-amber-800 border-amber-200", label: "Waiting", dot: "bg-amber-500" },
  ATTENTION: { chip: "bg-red-50 text-red-700 border-red-200", label: "Needs attention", dot: "bg-red-500" },
  NOT_CONFIGURED: { chip: "bg-slate-50 text-slate-600 border-slate-200", label: "Not set up", dot: "bg-slate-300" },
  // Deliberately worded as ours, not theirs: the merchant cannot act on this and should not
  // be left feeling they've missed a step.
  UNAVAILABLE: { chip: "bg-slate-50 text-slate-600 border-slate-200", label: "Coming soon", dot: "bg-slate-300" },
};

function Row({ item }: { item: ReadinessItem }) {
  const style = LEVEL_STYLES[item.level];
  return (
    <li className="flex gap-3 py-4">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-900">{item.label}</span>
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${style.chip}`}>
            {style.label}
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-500">{item.detail}</p>
        {item.action && (
          <Link
            href={item.action.href}
            className="mt-1.5 inline-block text-sm font-medium text-brand-600 hover:text-brand-700"
          >
            {item.action.label} →
          </Link>
        )}
      </div>
    </li>
  );
}

export function OnboardingCompleteView({ readiness: initial }: Props) {
  const router = useRouter();
  const [readiness, setReadiness] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/onboarding/complete", { method: "POST" });
      const data = (await res.json()) as Record<string, unknown>;

      // "already_complete" is a success, not an error: a refresh or a second tab lands here
      // and the merchant should go to their workspace, not see a failure.
      if (res.ok && (data.status === "ok" || data.status === "already_complete")) {
        setReadiness(data.readiness as OnboardingReadiness);
        router.push("/dashboard");
        router.refresh();
        return;
      }

      const err = data.error as { message?: string } | undefined;
      setError(err?.message ?? "Something went wrong. Try again.");
    } catch {
      setError("Can't reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const blocking = readiness.items.filter((i) => i.blocksSale && i.level !== "READY");
  const actionable = blocking.filter((i) => i.level !== "UNAVAILABLE");

  return (
    <div>
      <h2 className="text-3xl font-extrabold text-slate-900">
        {readiness.operationalReady ? "You're ready to sell" : "Setup complete"}
      </h2>

      {/*
        The headline claim is the one thing this screen must not get wrong. A full-width
        green "everything is ready" banner appears only when the server says every
        sale-blocking capability is verified READY. Otherwise the merchant is told, plainly,
        that the account is done and the system is not — with the specifics below.
      */}
      {readiness.operationalReady ? (
        <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Everything {readiness.businessName} needs to start selling is set up and working.
        </div>
      ) : (
        <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <p className="font-medium text-slate-800">
            Your workspace is ready. Some operational setup is still pending.
          </p>
          <p className="mt-1">
            You can go in and look around now, but{" "}
            <span className="font-medium text-slate-800">you can&apos;t take a sale yet</span> —
            the items marked below still need to be finished.
          </p>
        </div>
      )}

      {error && (
        <div
          role="alert"
          aria-live="assertive"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      <ul className="mt-6 divide-y divide-slate-100 border-y border-slate-100">
        {readiness.items.map((item) => (
          <Row key={item.key} item={item} />
        ))}
      </ul>

      <div className="mt-8 space-y-3">
        {readiness.onboardingComplete ? (
          <Link
            href="/dashboard"
            className="block w-full rounded-lg bg-brand-600 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
          >
            Go to your workspace
          </Link>
        ) : (
          <button
            type="button"
            onClick={finish}
            disabled={submitting}
            className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Finishing…" : "Finish setup and enter workspace"}
          </button>
        )}

        {/*
          Secondary actions come from the server's readiness items, so every link goes to a
          route that actually exists. The A10 wireframe sketches [Add Products] and
          [View Reports]; neither screen is built, and shipping buttons to nowhere would be
          the fake completion this project forbids. See DECISIONS.md ADR-072.
        */}
        {actionable.length > 0 && (
          <p className="text-center text-xs text-slate-500">
            Still to do:{" "}
            {actionable.map((item, i) => (
              <span key={item.key}>
                {i > 0 && ", "}
                {item.action ? (
                  <Link href={item.action.href} className="font-medium text-brand-600 hover:text-brand-700">
                    {item.label.toLowerCase()}
                  </Link>
                ) : (
                  <span className="font-medium text-slate-700">{item.label.toLowerCase()}</span>
                )}
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}
