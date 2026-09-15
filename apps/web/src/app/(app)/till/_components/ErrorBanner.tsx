"use client";

import type { PresentedError } from "@/client/platform/errorCatalog";
import { Button } from "./primitives";

/**
 * How a refusal is put in front of a cashier.
 *
 * Three things it always does. It names what happened in counter language; it says what to do
 * next; and it never shows a server or database string — the catalogue has already turned the
 * API's `code` into something a person can act on, and this component cannot be handed
 * anything else.
 *
 * The severity is not decoration. An `indeterminate` outcome is announced as a status rather
 * than an alert, because the correct posture when nobody knows whether a sale went through is
 * "wait and check", not "something failed". Saying "error" there is precisely what makes a
 * cashier ring the basket up twice.
 */
export function ErrorBanner({
  error,
  onDismiss,
}: {
  error: PresentedError;
  onDismiss?: () => void;
}) {
  const style =
    error.severity === "blocking"
      ? "border-amb-critical/30 bg-amb-critical-soft text-amb-critical"
      : error.severity === "indeterminate"
        ? "border-amb-info/30 bg-amb-info-soft text-amb-info"
        : "border-amb-caution/30 bg-amb-caution-soft text-amb-caution";

  return (
    <div
      // An alert interrupts; a status waits its turn. Which one this is depends on whether the
      // operator must act now, so the role follows the severity rather than being fixed.
      role={error.severity === "indeterminate" ? "status" : "alert"}
      aria-live={error.severity === "blocking" ? "assertive" : "polite"}
      className={`rounded-amb border px-4 py-3 ${style}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{error.title}</p>
          <p className="mt-0.5 text-sm opacity-90">{error.detail}</p>
          {error.recovery && <p className="mt-1.5 text-sm font-medium">{error.recovery}</p>}
          {error.correlationId && (
            <p className="mt-2 font-mono text-[0.65rem] opacity-70">
              Reference {error.correlationId}
            </p>
          )}
        </div>
        {onDismiss && (
          <Button tone="ghost" onClick={onDismiss} aria-label="Dismiss this message">
            Dismiss
          </Button>
        )}
      </div>
    </div>
  );
}
