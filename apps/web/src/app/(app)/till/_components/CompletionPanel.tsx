"use client";

import Link from "next/link";
import type { CompletionState } from "@/client/pos/completion";
import { formatMinor } from "@/server/sales/saleTotals";
import { Button, Chip, Kbd } from "./primitives";
import { ErrorBanner } from "./ErrorBanner";

/**
 * What happened to the sale.
 *
 * Takes over the screen once payment is committed, because the outcome of a sale is not
 * something to leave in a corner while the cashier starts the next basket.
 *
 * ## The two states most tills get wrong
 *
 * `unresolved` / `reconciling` — the server has not answered. The cashier is told the till is
 * *checking*, and explicitly told not to ring it up again. It is never called a failure,
 * because the sale may well have completed and a second attempt would charge twice.
 *
 * `undetermined` — repeated attempts all went unanswered. Still not a failure. The operator is
 * sent to the sale history to look before repeating anything, which is the only honest
 * instruction when nobody knows.
 *
 * A `duplicate` result is shown as a success, because it is one: the sale really happened. The
 * note simply says it was already recorded, so a cashier who pressed twice understands why the
 * bill number looks familiar rather than assuming a double charge.
 */

export function CompletionPanel({
  completion,
  onNewBill,
}: {
  completion: CompletionState;
  onNewBill: () => void;
}) {
  if (completion.phase === "idle") return null;

  return (
    <div className="flex h-full flex-col justify-center gap-5 px-6 py-10">
      {(completion.phase === "submitting" || completion.phase === "reconciling") && (
        <div role="status" aria-live="assertive" className="space-y-2 text-center">
          <p className="text-2xl font-bold text-amb-ink">
            {completion.phase === "submitting" ? "Taking payment…" : "Checking with the server…"}
          </p>
          <p className="mx-auto max-w-md text-sm text-amb-ink-secondary">
            {completion.phase === "submitting"
              ? "Do not close this screen."
              : "The first attempt went unanswered. The till is finding out what happened — do not ring this bill up again."}
          </p>
        </div>
      )}

      {completion.phase === "unresolved" && (
        <ErrorBanner error={completion.error} />
      )}

      {completion.phase === "completed" && (
        <div className="space-y-4 text-center">
          <div className="flex items-center justify-center gap-2">
            <p className="text-sm font-semibold uppercase tracking-wider text-amb-positive">
              Sale complete
            </p>
            {completion.duplicate && <Chip tone="info">Already recorded</Chip>}
          </div>
          <p className="amb-tnum text-5xl font-bold text-amb-ink">
            {formatMinor(completion.sale.totalMinor)}
          </p>
          <p className="amb-tnum text-lg font-semibold text-amb-ink-secondary">
            Bill {completion.sale.billNumber}
          </p>
          {completion.duplicate && (
            <p className="mx-auto max-w-md text-sm text-amb-ink-secondary">
              This bill had already been recorded, so the till returned the original sale rather
              than creating a second one. The customer has been charged once.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Button tone="accent" size="lg" shortcut="F9" onClick={onNewBill}>
              New bill
            </Button>
            <Link
              href={`/sales/${completion.sale.id}`}
              className="min-h-touch inline-flex items-center rounded-amb border border-amb-line-strong bg-amb-raised px-4 text-sm font-semibold text-amb-ink hover:bg-amb-sunken"
            >
              View bill
            </Link>
          </div>
          <p className="text-xs text-amb-ink-muted">
            Press <Kbd>F9</Kbd> or <Kbd>Esc</Kbd> to start the next bill.
          </p>
        </div>
      )}

      {completion.phase === "refused" && (
        <div className="space-y-4">
          <ErrorBanner error={completion.error} />
          <div className="flex justify-center">
            <Button tone="neutral" size="lg" onClick={onNewBill}>
              Back to the bill
            </Button>
          </div>
        </div>
      )}

      {completion.phase === "undetermined" && (
        <div className="space-y-4">
          <ErrorBanner error={completion.error} />
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/sales"
              className="min-h-touch inline-flex items-center rounded-amb bg-amb-accent px-5 text-sm font-semibold text-amb-accent-ink hover:bg-amb-accent-hover"
            >
              Check today&rsquo;s sales
            </Link>
            <Button tone="neutral" size="lg" onClick={onNewBill}>
              Start a new bill
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
