"use client";

import type { CompletionState } from "@/client/pos/completion";
import { canSubmit } from "@/client/pos/completion";
import type { PaymentMethod } from "@/client/pos/types";
import { formatMinor, type SaleTotals } from "@/server/sales/saleTotals";
import { Button, Field, Panel, inputClass } from "./primitives";

/**
 * Totals and tender.
 *
 * ## Only what the backend actually models
 *
 * One payment, one method, an optional operator-typed reference. There is no gateway, no
 * settlement, no reconciliation, no split tender, no card capture — and nothing here pretends
 * otherwise, because a payment UI that implies a capability the server does not have is a
 * promise made to a customer standing at a counter.
 *
 * The reference field is explicitly operator-typed: a UPI transaction id read off a phone, or
 * the last digits printed on a card terminal slip. It is never a token, and no card number is
 * accepted, stored or transmitted.
 *
 * ## Why there is no discount control
 *
 * Discount is accepted by the sale API but is not yet authorized server-side. Putting the
 * control on this screen would place an unguarded financial input at the counter, so it waits
 * for the authorization work rather than shipping ahead of it.
 */

const METHODS: { value: PaymentMethod; label: string; hint: string }[] = [
  { value: "CASH", label: "Cash", hint: "Counted at the counter" },
  { value: "UPI", label: "UPI", hint: "Reference from the customer's app" },
  { value: "CARD", label: "Card", hint: "Reference from the terminal slip" },
];

export function PaymentPanel({
  totals,
  itemCount,
  method,
  onMethod,
  reference,
  onReference,
  completion,
  onTakePayment,
  blocked,
  blockedReason,
}: {
  totals: SaleTotals;
  itemCount: number;
  method: PaymentMethod;
  onMethod: (method: PaymentMethod) => void;
  reference: string;
  onReference: (reference: string) => void;
  completion: CompletionState;
  onTakePayment: () => void;
  blocked: boolean;
  blockedReason?: string;
}) {
  const empty = totals.lines.length === 0;
  const busy = completion.phase === "submitting" || completion.phase === "reconciling";
  // Three independent reasons to refuse, kept independent: an empty bill, a shift that cannot
  // sell, and a submission already in flight. The state check is the guarantee; the disabled
  // attribute is only how it is shown.
  const disabled = empty || blocked || busy || !canSubmit(completion);

  return (
    <Panel title="Payment">
      <div className="space-y-4 px-4 py-4">
        <dl className="space-y-1.5">
          <Row label="Items" value={String(itemCount)} />
          <Row label="Subtotal" value={formatMinor(totals.subtotalMinor)} />
          <Row label="Tax" value={formatMinor(totals.taxMinor)} />
          <div className="mt-2 flex items-baseline justify-between border-t border-amb-line pt-3">
            <dt className="text-sm font-semibold uppercase tracking-wider text-amb-ink-muted">
              Total
            </dt>
            <dd className="amb-tnum text-3xl font-bold text-amb-ink">
              {formatMinor(totals.totalMinor)}
            </dd>
          </div>
        </dl>
        <p className="text-xs text-amb-ink-muted">
          Shown from prices the server sent. The server recalculates every figure before charging.
        </p>

        <fieldset disabled={busy}>
          <legend className="mb-2 text-xs font-semibold uppercase tracking-wider text-amb-ink-muted">
            Method
          </legend>
          <div className="grid grid-cols-3 gap-2">
            {METHODS.map((entry) => (
              <button
                key={entry.value}
                type="button"
                onClick={() => onMethod(entry.value)}
                aria-pressed={method === entry.value}
                className={`min-h-touch rounded-amb border px-2 py-2 text-sm font-semibold transition-colors ${
                  method === entry.value
                    ? "border-amb-accent bg-amb-accent-soft text-amb-accent"
                    : "border-amb-line-strong bg-amb-raised text-amb-ink hover:bg-amb-sunken"
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </fieldset>

        {method !== "CASH" && (
          <Field
            label="Reference"
            hint="Optional. Typed by you from the customer's app or the terminal slip — never a card number."
          >
            <input
              className={inputClass}
              value={reference}
              onChange={(event) => onReference(event.target.value)}
              maxLength={100}
              disabled={busy}
              autoComplete="off"
              inputMode="text"
              placeholder="Transaction reference"
            />
          </Field>
        )}

        <Button
          tone="accent"
          size="lg"
          shortcut="F9"
          onClick={onTakePayment}
          disabled={disabled}
          className="w-full"
        >
          {busy ? "Processing…" : `Take ${formatMinor(totals.totalMinor)}`}
        </Button>

        {blocked && blockedReason && (
          <p className="text-xs font-medium text-amb-caution">{blockedReason}</p>
        )}
      </div>
    </Panel>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-sm text-amb-ink-secondary">{label}</dt>
      <dd className="amb-tnum text-sm font-medium text-amb-ink">{value}</dd>
    </div>
  );
}
