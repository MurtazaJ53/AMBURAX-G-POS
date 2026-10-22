"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/client/platform/apiClient";
import { buttonClass } from "../../_components/ui";
import { MAX_CREDIT_MODE_LIMIT_MINOR, type CreditModeValue } from "@/server/khata/creditMode";

interface CreditView {
  companyName: string;
  currency: string;
  accountExists: boolean;
  mode: CreditModeValue;
  limitMinor: number | null;
  source: "COMPANY_DEFAULT" | "OWNER_OVERRIDE" | "MIGRATED" | null;
  setAt: string | null;
  companyDefault: { mode: CreditModeValue; limitMinor: number | null };
  hold: boolean;
}

const MODE_LABEL: Record<CreditModeValue, string> = {
  BLOCKED: "Off — no udhar",
  UNLIMITED: "Unlimited (not accepted at the till)",
  LIMITED: "On — up to a limit",
};

const FIELD =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20";

function money(minor: number): string {
  return `${Math.floor(minor / 100).toLocaleString("en-IN")}.${String(minor % 100).padStart(2, "0")}`;
}

function toInput(minor: number | null): string {
  return minor === null ? "" : `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, "0")}`;
}

/** Major-unit text to integer minor units; null when not a positive amount within range. */
function parseAmount(raw: string): number | null {
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(raw.trim());
  if (!match) return null;
  const minor = BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  if (minor <= 0n || minor > BigInt(MAX_CREDIT_MODE_LIMIT_MINOR)) return null;
  return Number(minor);
}

function describe(view: CreditView): string {
  const limit = view.mode === "LIMITED" && view.limitMinor !== null ? ` · ${view.currency} ${money(view.limitMinor)}` : "";
  return `${MODE_LABEL[view.mode]}${limit}${view.hold ? " · on hold" : ""}`;
}

/**
 * Udhar access for one customer (Q5/Q10, owner 2026-10-14). The owner or the accountant switches it
 * on with a finite limit, or puts it on hold, always with a reason that is audited with the old and
 * new values. A new customer starts with no udhar.
 */
export function CustomerCreditMode({ customerId }: { customerId: string }) {
  const url = `/api/v1/customers/${encodeURIComponent(customerId)}/credit-mode`;
  const [view, setView] = useState<CreditView | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const apply = (next: CreditView) => {
    setView(next);
    setEnabled(next.mode === "LIMITED");
    setAmount(toInput(next.limitMinor));
    setReason("");
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    const result = await apiRequest<{ credit: CreditView }>(url);
    if (result.ok) apply(result.data.credit);
    else setError(result.kind === "api" ? result.message || "Could not load Udhar access." : "Could not load Udhar access. Check your connection and retry.");
    setLoading(false);
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  const send = async (body: Record<string, unknown>, done: string) => {
    setError(null);
    setSuccess(null);
    if (reason.trim().length < 3) {
      setError("Give a reason for the change.");
      return;
    }
    setSaving(true);
    const result = await apiRequest<{ credit: CreditView }>(url, { method: "POST", body: { ...body, reason: reason.trim() } });
    setSaving(false);
    if (result.ok) {
      apply(result.data.credit);
      setSuccess(done);
    } else if (result.kind === "api") {
      setError(result.message || "Could not save Udhar access.");
    } else {
      setError("The save outcome is unknown. Reload before trying again.");
    }
  };

  const save = () => {
    if (!enabled) return void send({ mode: "BLOCKED", limitMinor: null }, "Udhar switched off for this customer.");
    const limitMinor = parseAmount(amount);
    if (limitMinor === null) {
      setError(`Enter a positive limit with at most two decimal places, no more than ${money(MAX_CREDIT_MODE_LIMIT_MINOR)}.`);
      return;
    }
    void send({ mode: "LIMITED", limitMinor }, "Saved. The new limit applies to the next bill.");
  };

  if (loading) return <p className="px-5 py-4 text-sm text-slate-600">Loading Udhar access…</p>;
  if (!view) {
    return (
      <div className="space-y-3 px-5 py-4 text-sm">
        <p role="alert" className="text-red-700">{error ?? "Udhar access is unavailable."}</p>
        <button type="button" onClick={() => void load()} className={buttonClass("secondary")}>Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-4 px-5 py-4 text-sm">
      <dl className="space-y-1">
        <div className="flex justify-between gap-4">
          <dt className="text-slate-600">Now</dt>
          <dd className="text-right font-semibold text-slate-900">{describe(view)}</dd>
        </div>
        <dd className="text-xs text-slate-500">{view.companyName} ({view.currency}) · shared by this company&apos;s stores</dd>
      </dl>

      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
        At the till, udhar needs a verified phone, this switched on with a limit, no overdue bill and no hold.
      </p>

      <label className="flex min-h-11 items-center gap-3 font-medium text-slate-700">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setSuccess(null);
          }}
          className="h-5 w-5 rounded border-slate-300 text-sky-600"
        />
        Allow udhar up to a limit
      </label>

      {enabled && (
        <div className="amb-fade-in">
          <label htmlFor="customer-credit-limit" className="mb-1.5 block font-medium text-slate-700">
            Limit ({view.currency})
          </label>
          <input
            id="customer-credit-limit"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setSuccess(null);
            }}
            placeholder="For example, 10000.00"
            className={FIELD}
          />
        </div>
      )}

      <div>
        <label htmlFor="customer-credit-reason" className="mb-1.5 block font-medium text-slate-700">
          Reason
        </label>
        <input
          id="customer-credit-reason"
          type="text"
          maxLength={200}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Regular buyer for 2 years"
          className={FIELD}
        />
      </div>

      {error && <p role="alert" className="text-red-700">{error}</p>}
      {success && <p role="status" className="amb-pop-in text-emerald-700">{success}</p>}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={saving} className={buttonClass("primary")}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() =>
            void send({ hold: !view.hold }, view.hold ? "Hold lifted." : "Udhar on hold. Collections and returns still work.")
          }
          disabled={saving}
          className={buttonClass("secondary")}
        >
          {view.hold ? "Lift hold" : "Put on hold"}
        </button>
      </div>
    </div>
  );
}
