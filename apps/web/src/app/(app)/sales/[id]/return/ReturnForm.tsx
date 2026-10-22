"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Loader2, Minus, Plus, RotateCcw } from "lucide-react";
import { formatMinor } from "@/server/sales/saleTotals";

/**
 * The refund itself.
 *
 * Two things here are deliberate and worth knowing before changing them.
 *
 * First, every amount shown before submission is a *preview*. It applies the same proration the
 * server applies — `round(lineTotal × qty / soldQty)` — so the manager is not approving a
 * mystery, but it is labelled as a preview and the figure written to the ledger is the
 * `totalRefundMinor` the API returns. The client never gets the last word on money.
 *
 * Second, the idempotency key is minted once per *attempt*, not once per render and not once per
 * keystroke. A failed attempt that may or may not have committed is retried under the same key,
 * so a timeout cannot become two refunds; changing the basket mints a new one, because that is a
 * different refund.
 */

export interface ReturnLine {
  id: string;
  name: string;
  sku: string;
  soldQuantity: number;
  alreadyReturned: number;
  returnableQuantity: number;
  lineTotalMinor: number;
}

type RefundMethod = "CASH" | "UPI" | "CARD";

const REFUND_METHODS: { value: RefundMethod; label: string }[] = [
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "CARD", label: "Card" },
];

interface CreatedReturn {
  id: string;
  totalRefundMinor: number;
  erpSyncStatus: string;
  duplicate: boolean;
}

/**
 * One key per refund attempt. Crypto only — no `Math.random`, which the purity rule rightly
 * refuses, and `randomUUID` is unavailable on a non-secure origin where `getRandomValues` is not.
 */
function newAttemptKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `ret-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** The server's rule, mirrored for the preview only. */
function proratedRefundMinor(line: ReturnLine, quantity: number): number {
  if (quantity <= 0 || line.soldQuantity <= 0) return 0;
  return Math.round(line.lineTotalMinor * (quantity / line.soldQuantity));
}

/** A till this person may pay a cash refund from (E7), with the cash it should hold. */
export interface PayoutTill {
  id: string;
  label: string;
  cashMinor: number;
  mine: boolean;
}

export function ReturnForm({
  saleId,
  billNumber,
  lines,
  totalPaidMinor,
  backHref,
  tills,
}: {
  saleId: string;
  billNumber: string;
  lines: ReturnLine[];
  totalPaidMinor: number;
  backHref: string;
  tills: PayoutTill[];
}) {
  const router = useRouter();

  const [quantities, setQuantities] = React.useState<Record<string, number>>({});
  const [method, setMethod] = React.useState<RefundMethod>("CASH");
  const [reference, setReference] = React.useState("");
  const [tillId, setTillId] = React.useState(() => (tills.find((t) => t.mine) ?? tills[0])?.id ?? "");
  const till = tills.find((t) => t.id === tillId) ?? null;
  const [reason, setReason] = React.useState("");

  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<CreatedReturn | null>(null);

  // Held across retries of the same attempt; cleared whenever the basket changes.
  const attemptKeyRef = React.useRef<string | null>(null);

  const setQuantity = (line: ReturnLine, next: number) => {
    const clamped = Math.max(0, Math.min(line.returnableQuantity, next));
    attemptKeyRef.current = null;
    setError(null);
    setQuantities((prev) => ({ ...prev, [line.id]: clamped }));
  };

  const selected = lines
    .map((line) => ({ line, quantity: quantities[line.id] ?? 0 }))
    .filter((row) => row.quantity > 0);

  const previewTotalMinor = selected.reduce(
    (sum, row) => sum + proratedRefundMinor(row.line, row.quantity),
    0,
  );

  const unitCount = selected.reduce((n, row) => n + row.quantity, 0);
  const exceedsCollected = previewTotalMinor > totalPaidMinor;
  // Cash comes out of a named till that holds enough of it (E7); the server checks again under lock.
  const cashBlocked = method === "CASH" && (!till || previewTotalMinor > till.cashMinor);
  const canSubmit = selected.length > 0 && !submitting && !exceedsCollected && !cashBlocked;

  async function submit() {
    if (!canSubmit) return;

    if (attemptKeyRef.current === null) {
      attemptKeyRef.current = newAttemptKey();
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/v1/sales/${saleId}/returns`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          idempotencyKey: attemptKeyRef.current,
          posSessionId: method === "CASH" ? tillId || undefined : undefined,
          reason: reason.trim() || undefined,
          items: selected.map((row) => ({
            originalSaleItemId: row.line.id,
            quantity: row.quantity,
          })),
          refundPayments: [
            {
              method,
              amountMinor: previewTotalMinor,
              reference: reference.trim() || undefined,
            },
          ],
        }),
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(
          body?.error?.message ??
            "The return could not be completed. Nothing was processed — please try again.",
        );
        return;
      }

      setCreated({
        id: body.saleReturn?.id ?? "",
        // The server's figure, not the preview.
        totalRefundMinor: body.saleReturn?.totalRefundMinor ?? 0,
        erpSyncStatus: body.saleReturn?.erpSyncStatus ?? "PENDING",
        duplicate: Boolean(body.duplicate),
      });
      // The bill's returned quantities have changed.
      router.refresh();
    } catch {
      setError("No connection. Nothing was processed — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  /* ------------------------------------------------------------------ success */

  if (created) {
    const posted =
      created.erpSyncStatus === "SYNCED" ||
      created.erpSyncStatus === "POSTED" ||
      created.erpSyncStatus === "SUCCESS";

    return (
      <div className="amb-pop-in mt-5 max-w-xl">
        <div className="rounded-lg border border-success-subtle bg-success-subtle p-4">
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success text-white"
            >
              <Check className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-[14px] font-semibold text-success">
                {created.duplicate ? "This return was already recorded" : "Return recorded"}
              </h2>
              <p className="mt-1 text-[12px] leading-relaxed text-success">
                {created.duplicate
                  ? "The same request had already been processed, so nothing was refunded twice. Below is the existing return."
                  : `Refunded against ${billNumber}. Stock has been put back.`}
              </p>
            </div>
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-success-subtle pt-3 text-[12px]">
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-success">
                Refunded
              </dt>
              {/* Not animated: a figure must read instantly. */}
              <dd className="mt-0.5 font-mono text-[16px] font-bold tabular-nums text-success">
                {formatMinor(created.totalRefundMinor)}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-success">
                Backend sync
              </dt>
              <dd className="mt-0.5 text-[13px] font-medium text-success">
                {posted ? "Submitted" : "Pending"}
              </dd>
            </div>
          </dl>
          {!posted && (
            <p className="mt-2 text-[11px] leading-relaxed text-success">
              The return is queued for Backend and has not been posted there yet.
            </p>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/sales//returns/${created.id}`}
            className="amb-press amb-focus inline-flex h-11 items-center justify-center rounded-lg bg-primary px-4 text-[13px] font-semibold text-white"
          >
            View return
          </Link>
          <Link
            href={backHref}
            className="amb-press amb-focus inline-flex h-11 items-center justify-center rounded-lg border border-border bg-background-card px-4 text-[13px] font-medium text-secondary hover:text-primary"
          >
            Back to bill
          </Link>
          <Link
            href="/sales"
            className="amb-press amb-focus inline-flex h-11 items-center justify-center rounded-lg border border-border bg-background-card px-4 text-[13px] font-medium text-secondary hover:text-primary"
          >
            All sales
          </Link>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------------- form */

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"
    >
      {/* ---------------------------------------------------------- the lines */}
      <section aria-labelledby="return-lines-heading" className="min-w-0">
        <h2
          id="return-lines-heading"
          className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-secondary"
        >
          What is coming back
        </h2>

        <ul className="divide-y divide-border rounded-lg border border-border bg-background-card">
          {lines.map((line) => {
            const quantity = quantities[line.id] ?? 0;
            const exhausted = line.returnableQuantity === 0;
            const qtyId = `return-qty-${line.id}`;

            return (
              <li key={line.id} className="amb-line-in p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-primary">{line.name}</p>
                    <p className="mt-0.5 truncate text-[11px] text-tertiary">
                      {line.sku} · sold {line.soldQuantity}
                      {line.alreadyReturned > 0 && ` · ${line.alreadyReturned} already returned`}
                    </p>
                    {exhausted ? (
                      <p className="mt-1 text-[11px] font-medium text-tertiary">
                        Fully returned — nothing left on this line.
                      </p>
                    ) : (
                      <p className="mt-1 text-[11px] text-secondary">
                        Up to {line.returnableQuantity} returnable ·{" "}
                        <span className="font-mono tabular-nums">
                          {formatMinor(line.lineTotalMinor)}
                        </span>{" "}
                        for {line.soldQuantity}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setQuantity(line, quantity - 1)}
                        disabled={exhausted || quantity === 0}
                        aria-label={`Return one fewer ${line.name}`}
                        className="amb-press amb-focus flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-background-card text-secondary transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Minus aria-hidden="true" className="h-4 w-4" />
                      </button>

                      <label htmlFor={qtyId} className="sr-only">
                        Quantity of {line.name} to return, up to {line.returnableQuantity}
                      </label>
                      <input
                        id={qtyId}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={line.returnableQuantity}
                        value={quantity}
                        disabled={exhausted}
                        onChange={(event) => {
                          const next = Number.parseInt(event.target.value, 10);
                          setQuantity(line, Number.isFinite(next) ? next : 0);
                        }}
                        className="amb-focus h-11 w-14 rounded-lg border border-border bg-background-card text-center font-mono text-[14px] tabular-nums text-primary disabled:cursor-not-allowed disabled:opacity-40"
                      />

                      <button
                        type="button"
                        onClick={() => setQuantity(line, quantity + 1)}
                        disabled={exhausted || quantity >= line.returnableQuantity}
                        aria-label={`Return one more ${line.name}`}
                        className="amb-press amb-focus flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-background-card text-secondary transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Plus aria-hidden="true" className="h-4 w-4" />
                      </button>
                    </div>

                    <span className="w-20 shrink-0 text-right font-mono text-[13px] tabular-nums text-primary">
                      {quantity > 0 ? formatMinor(proratedRefundMinor(line, quantity)) : "—"}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mt-4">
          <label htmlFor="return-reason" className="mb-1 block text-[11.5px] font-medium text-secondary">
            Reason <span className="font-normal text-tertiary">(optional)</span>
          </label>
          <input
            id="return-reason"
            type="text"
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Damaged, wrong size, customer changed their mind…"
            className="amb-focus h-11 w-full rounded-lg border border-border bg-background-card px-3 text-[13px] text-primary placeholder:text-tertiary"
          />
        </div>
      </section>

      {/* -------------------------------------------------------- the refund */}
      <section aria-labelledby="refund-heading" className="min-w-0">
        <h2
          id="refund-heading"
          className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-secondary"
        >
          Refund
        </h2>

        <div className="rounded-lg border border-border bg-background-card p-4">
          <dl className="space-y-1.5 text-[12px]">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-secondary">Units</dt>
              <dd className="font-mono tabular-nums text-primary">{unitCount}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2">
              <dt className="font-semibold text-primary">
                Refund <span className="font-normal text-tertiary">(preview)</span>
              </dt>
              <dd className="font-mono text-[18px] font-bold tabular-nums text-primary">
                {formatMinor(previewTotalMinor)}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-[10.5px] leading-relaxed text-tertiary">
            The server recalculates this from the recorded line totals and has the final say.
          </p>

          <fieldset className="mt-4">
            <legend className="mb-1.5 text-[11.5px] font-medium text-secondary">
              Refund method
            </legend>
            <div className="grid grid-cols-3 gap-1.5">
              {REFUND_METHODS.map((option) => {
                const active = method === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setMethod(option.value)}
                    aria-pressed={active}
                    className={`amb-press amb-focus h-11 rounded-lg border text-[12.5px] font-medium transition-colors ${
                      active
                        ? "border-primary bg-primary text-white"
                        : "border-border bg-background-card text-secondary hover:text-primary"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {method === "CASH" && (
            <div className="amb-fade-in mt-3">
              {tills.length === 0 ? (
                <p role="status" className="rounded-lg bg-warning-subtle px-3 py-2 text-[12px] text-primary">
                  No till is open that you can pay cash from. Open a till first, or refund by UPI or card.
                </p>
              ) : (
                <>
                  <label htmlFor="refund-till" className="mb-1 block text-[11.5px] font-medium text-secondary">
                    Paid from till
                  </label>
                  <select
                    id="refund-till"
                    value={tillId}
                    onChange={(event) => {
                      attemptKeyRef.current = null;
                      setTillId(event.target.value);
                    }}
                    className="amb-focus h-11 w-full rounded-lg border border-border bg-background-card px-3 text-[13px] text-primary"
                  >
                    {tills.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label} — holds {formatMinor(t.cashMinor)}
                      </option>
                    ))}
                  </select>
                  {till && previewTotalMinor > till.cashMinor && (
                    <p role="alert" className="mt-1.5 text-[12px] text-danger">
                      This till holds {formatMinor(till.cashMinor)}, less than the refund. Choose another till or refund by UPI or card.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          <div className="mt-3">
            <label
              htmlFor="return-reason"
              className="mb-1 block text-[11.5px] font-medium text-secondary"
            >
              Reason for return
            </label>
            <select
              id="return-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="amb-focus h-11 w-full rounded-lg border border-border bg-background-card px-3 text-[13px] text-primary"
            >
              <option value="">Select a reason...</option>
              <option value="DEFECTIVE">Defective / Damaged Piece</option>
              <option value="SIZE_MISMATCH">Size / Fitting Mismatch</option>
              <option value="COLOR_STYLE">Color / Style Not Liked</option>
              <option value="WRONG_ITEM">Wrong Item Billed</option>
              <option value="CUSTOMER_MIND">Customer Changed Mind</option>
              <option value="OTHER">Other Reason</option>
            </select>
          </div>

          <div className="mt-3">
            <label
              htmlFor="refund-reference"
              className="mb-1 block text-[11.5px] font-medium text-secondary"
            >
              Reference / Note <span className="font-normal text-tertiary">(optional)</span>
            </label>
            <input
              id="refund-reference"
              type="text"
              maxLength={100}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="UPI reference, card slip, condition note…"
              className="amb-focus h-11 w-full rounded-lg border border-border bg-background-card px-3 text-[13px] text-primary placeholder:text-tertiary"
            />
          </div>

          {exceedsCollected && (
            <p
              role="alert"
              className="amb-fade-in mt-3 rounded-md border border-warning-subtle bg-warning-subtle px-2.5 py-2 text-[11.5px] leading-relaxed text-warning"
            >
              This refund is more than the {formatMinor(totalPaidMinor)} collected on the bill. Part
              of it was taken on khata, so the receivable has to be reversed first.
            </p>
          )}

          {error && (
            <div
              role="alert"
              className="amb-fade-in mt-3 flex items-start gap-2 rounded-md border border-danger-subtle bg-danger-subtle px-2.5 py-2 text-[11.5px] leading-relaxed text-danger"
            >
              <AlertCircle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0">{error}</span>
            </div>
          )}

          <div className="mt-4 flex flex-col gap-2">
            <button
              type="submit"
              disabled={!canSubmit}
              className="amb-press amb-focus inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary text-[14px] font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? (
                <>
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  Refunding…
                </>
              ) : error ? (
                <>
                  <RotateCcw aria-hidden="true" className="h-4 w-4" />
                  Try again
                </>
              ) : (
                "Refund this return"
              )}
            </button>
            <Link
              href={backHref}
              className="amb-press amb-focus inline-flex h-11 w-full items-center justify-center rounded-lg border border-border bg-background-card text-[13px] font-medium text-secondary hover:text-primary"
            >
              Cancel
            </Link>
          </div>

          <p className="sr-only" role="status" aria-live="polite">
            {submitting
              ? "Processing the refund"
              : selected.length === 0
                ? "No items selected to return"
                : `${unitCount} unit${unitCount === 1 ? "" : "s"} selected, refund preview ${formatMinor(previewTotalMinor)}`}
          </p>
        </div>
      </section>
    </form>
  );
}
