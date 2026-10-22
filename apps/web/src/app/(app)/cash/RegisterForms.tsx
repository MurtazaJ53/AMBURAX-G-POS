"use client";

import { useActionState, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Lock, Wallet } from "lucide-react";
import { formatMinor } from "@/server/sales/saleTotals";
import { buttonClass } from "../_components/ui";
import { approveVarianceAction, closeCountAction, movementAction, setFloatAction, type CashActionState } from "./actions";

const IDLE: CashActionState = { status: "idle" };
const INPUT =
  "amb-focus block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500";

function toMinor(raw: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw.replaceAll(",", "").trim());
  if (!m) return Number.NaN;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
}

function Message({ state }: { state: CashActionState }) {
  if (state.status === "idle") return null;
  if (state.status === "approval") {
    return (
      <p role="alert" className="amb-pop-in rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
        {state.message}
      </p>
    );
  }
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={`amb-pop-in rounded-lg px-3 py-2 text-sm ${
        state.status === "error" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"
      }`}
    >
      {state.message}
    </p>
  );
}

export function FloatForm({ sessionId }: { sessionId: string }) {
  const [state, action, pending] = useActionState(setFloatAction, IDLE);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <Message state={state} />
      <label className="block text-sm font-medium text-slate-700">
        Cash in the drawer now (₹)
        <input name="amount" inputMode="decimal" required placeholder="2000" className={`${INPUT} mt-1 tabular-nums`} />
      </label>
      <button type="submit" disabled={pending} aria-busy={pending} className={`${buttonClass("primary")} amb-press w-full justify-center`}>
        <Wallet aria-hidden="true" className="h-4 w-4" />
        {pending ? "Saving…" : "Record opening float"}
      </button>
      <p className="text-xs text-slate-500">Recorded once per shift. Fix a mistake with a pay-in or pay-out.</p>
    </form>
  );
}

const CATEGORIES = [
  ["PETTY_EXPENSE", "Petty expense"],
  ["SUPPLIER_PAYMENT", "Supplier payment"],
  ["STAFF_ADVANCE", "Staff advance"],
  ["BANK_DEPOSIT", "Bank deposit"],
  ["OTHER", "Other"],
] as const;

export function MovementForm({
  sessionId,
  approvers,
}: {
  sessionId: string;
  approvers: { id: string; name: string; owner: boolean }[];
}) {
  const [state, action, pending] = useActionState(movementAction, IDLE);
  // A fresh key after each saved movement, so the next one is new while a double-click is not.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [seen, setSeen] = useState(state.nonce);
  const [kind, setKind] = useState<"PAY_IN" | "PAY_OUT">("PAY_OUT");
  if (state.nonce !== seen) {
    setSeen(state.nonce);
    if (state.status === "success") setKey(crypto.randomUUID());
  }
  const needsApproval = state.status === "approval";
  const eligible = state.level === "OWNER" ? approvers.filter((a) => a.owner) : approvers;
  return (
    <form action={action} key={key} className="space-y-3">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="key" value={key} />
      <Message state={state} />
      <div role="radiogroup" aria-label="Direction" className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-0.5">
        {(["PAY_OUT", "PAY_IN"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={`amb-focus inline-flex min-h-11 items-center justify-center gap-2 rounded-md text-sm font-semibold transition-colors ${
              kind === k ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {k === "PAY_IN" ? (
              <ArrowDownToLine aria-hidden="true" className="h-4 w-4 text-emerald-600" />
            ) : (
              <ArrowUpFromLine aria-hidden="true" className="h-4 w-4 text-rose-600" />
            )}
            {k === "PAY_IN" ? "Pay in" : "Pay out"}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-medium text-slate-700">
          Amount (₹)
          <input name="amount" inputMode="decimal" required className={`${INPUT} mt-1 tabular-nums`} />
        </label>
        {kind === "PAY_OUT" ? (
          <label className="text-sm font-medium text-slate-700">
            For
            <select name="category" required defaultValue="PETTY_EXPENSE" className={`${INPUT} mt-1`}>
              {CATEGORIES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span />
        )}
      </div>
      {kind === "PAY_OUT" && (
        <label className="block text-sm font-medium text-slate-700">
          Paid to
          <input name="payee" required maxLength={140} placeholder="Ravi Tea Stall" className={`${INPUT} mt-1`} />
        </label>
      )}
      <label className="block text-sm font-medium text-slate-700">
        Reason
        <input
          name="reason"
          required
          maxLength={140}
          placeholder={kind === "PAY_IN" ? "Change from bank" : "Tea for staff"}
          className={`${INPUT} mt-1`}
        />
      </label>
      {needsApproval && kind === "PAY_OUT" && (
        <fieldset className="amb-pop-in space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <legend className="px-1 text-sm font-semibold text-amber-900">Approval</legend>
          {eligible.length === 0 ? (
            <p className="text-sm text-amber-900">No approver here has set a PIN yet. They can set one under Security.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm font-medium text-slate-700">
                Approver
                <select name="approverUserId" required className={`${INPUT} mt-1`}>
                  {eligible.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-medium text-slate-700">
                Their PIN
                <input
                  name="pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  required
                  maxLength={6}
                  className={`${INPUT} mt-1`}
                />
              </label>
            </div>
          )}
        </fieldset>
      )}
      <button type="submit" disabled={pending} aria-busy={pending} className={`${buttonClass("primary")} amb-press w-full justify-center`}>
        {pending ? "Saving…" : kind === "PAY_IN" ? "Record pay-in" : needsApproval ? "Approve and pay out" : "Record pay-out"}
      </button>
    </form>
  );
}

/** E4: a manager accepts a counted difference with a reason. */
export function ApproveVarianceForm({ sessionId }: { sessionId: string }) {
  const [state, action, pending] = useActionState(approveVarianceAction, IDLE);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <Message state={state} />
      <label className="block text-sm font-medium text-slate-700">
        Why it is accepted
        <textarea name="note" rows={2} required minLength={3} maxLength={500} className={`${INPUT} mt-1 py-2`} />
      </label>
      <button type="submit" disabled={pending} aria-busy={pending} className={`${buttonClass("primary")} amb-press w-full justify-center`}>
        {pending ? "Approving…" : "Approve difference"}
      </button>
    </form>
  );
}

const METHOD_LABEL = { CASH: "Cash in drawer", UPI: "UPI received", CARD: "Card settled" } as const;

export function CloseCountForm({ sessionId, expected }: { sessionId: string; expected: Record<"CASH" | "UPI" | "CARD", number> }) {
  const [state, action, pending] = useActionState(closeCountAction, IDLE);
  // UPI and card are already known from the day's sales, so they start filled in (editable if the
  // bank shows otherwise). Cash starts empty on purpose: it must be counted, or a short drawer would
  // never show. "Cash matches" fills it in one tap when the count agrees.
  const rupees = (minor: number) => (minor / 100).toFixed(minor % 100 === 0 ? 0 : 2);
  const [counted, setCounted] = useState<Record<string, string>>({
    CASH: "",
    UPI: rupees(expected.UPI),
    CARD: rupees(expected.CARD),
  });
  const diffs = (["CASH", "UPI", "CARD"] as const).map((m) => {
    const c = toMinor(counted[m] ?? "");
    return { m, diff: Number.isFinite(c) ? c - expected[m] : null };
  });
  const mismatch = diffs.some((d) => d.diff !== null && d.diff !== 0);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <Message state={state} />
      <ul className="space-y-2">
        {diffs.map(({ m, diff }) => (
          <li key={m} className="grid grid-cols-[1fr_120px] items-end gap-3">
            <label className="text-sm font-medium text-slate-700">
              {METHOD_LABEL[m]} (₹)
              <span className="block text-xs font-normal text-slate-500">Expected {formatMinor(expected[m])}</span>
              <input
                name={m}
                inputMode="decimal"
                required
                value={counted[m]}
                onChange={(e) => setCounted((c) => ({ ...c, [m]: e.target.value }))}
                className={`${INPUT} mt-1 tabular-nums`}
              />
              {m === "CASH" && (
                <button
                  type="button"
                  onClick={() => setCounted((c) => ({ ...c, CASH: rupees(expected.CASH) }))}
                  className={`${buttonClass("secondary")} amb-press mt-2 w-full justify-center`}
                >
                  I counted it: cash matches {formatMinor(expected.CASH)}
                </button>
              )}
              {m !== "CASH" && (
                <span className="mt-1 block text-xs font-normal text-slate-500">Filled in from today&apos;s sales. Change it only if the bank shows a different amount.</span>
              )}
            </label>
            <span
              aria-live="polite"
              className={`pb-3 text-right text-sm font-semibold tabular-nums ${
                diff === null ? "text-slate-500" : diff === 0 ? "text-emerald-700" : diff > 0 ? "text-sky-700" : "text-rose-700"
              }`}
            >
              {diff === null ? "—" : diff === 0 ? "Matches" : `${diff > 0 ? "+" : "−"}${formatMinor(Math.abs(diff))}`}
            </span>
          </li>
        ))}
      </ul>
      <label className="block text-sm font-medium text-slate-700">
        Note{" "}
        {mismatch ? (
          <span className="text-rose-700">(needed — the count doesn&apos;t match)</span>
        ) : (
          <span className="font-normal text-slate-500">(optional)</span>
        )}
        <textarea name="note" rows={2} maxLength={500} required={mismatch} className={`${INPUT} mt-1 py-2`} />
      </label>
      <button type="submit" disabled={pending} aria-busy={pending} className={`${buttonClass("primary")} amb-press w-full justify-center`}>
        <Lock aria-hidden="true" className="h-4 w-4" />
        {pending ? "Closing…" : "Close shift with this count"}
      </button>
    </form>
  );
}
