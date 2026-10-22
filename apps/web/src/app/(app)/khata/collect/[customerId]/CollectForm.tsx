"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HandCoins } from "lucide-react";
import { formatMinor } from "@/server/sales/saleTotals";
import { buttonClass } from "../../../_components/ui";

const INPUT =
  "amb-focus block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500";

function toMinor(raw: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw.replaceAll(",", "").trim());
  if (!m) return Number.NaN;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
}

interface Done {
  appliedMinor: number;
  changeMinor: number;
  remainingMinor: number;
  allocations: { billNumber: string; amountMinor: number }[];
}

/** Q6/Q7: collect against the oldest bills; shows change for cash and refuses UPI/card overpayment. */
export function CollectForm({ customerId, owedMinor }: { customerId: string; owedMinor: number }) {
  const router = useRouter();
  const [method, setMethod] = useState<"CASH" | "UPI" | "CARD">("CASH");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const tendered = toMinor(amount);
  const change = method === "CASH" && Number.isFinite(tendered) && tendered > owedMinor ? tendered - owedMinor : 0;
  const over = method !== "CASH" && Number.isFinite(tendered) && tendered > owedMinor;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!Number.isFinite(tendered) || tendered <= 0) return setError("Enter the amount received.");
    if (over) return setError("That is more than is owed. Take exactly what is due by UPI or card.");
    setBusy(true);
    try {
      const res = await fetch("/api/v1/khata/payments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerId,
          amountMinor: tendered,
          paymentMethod: method,
          reference: reference.trim() || undefined,
          idempotencyKey: key,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error?.message ?? "That payment wasn't recorded. Try again — it won't be taken twice.");
        return;
      }
      setDone(data);
      setKey(crypto.randomUUID());
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Try again — it won't be taken twice.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="amb-pop-in space-y-3" role="status">
        <p className="text-base font-semibold text-emerald-800">Received {formatMinor(done.appliedMinor)}</p>
        {done.changeMinor > 0 && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">Give change: {formatMinor(done.changeMinor)}</p>
        )}
        <ul className="space-y-1 text-sm text-slate-700">
          {done.allocations.map((a) => (
            <li key={a.billNumber} className="flex justify-between">
              <span className="font-mono">{a.billNumber}</span>
              <span className="tabular-nums">{formatMinor(a.amountMinor)}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-slate-600">Still owes {formatMinor(done.remainingMinor)}.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && (
        <p role="alert" className="amb-pop-in rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}
      <div role="radiogroup" aria-label="Paid by" className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-0.5">
        {(["CASH", "UPI", "CARD"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={method === m}
            onClick={() => setMethod(m)}
            className={`amb-focus min-h-11 rounded-md text-sm font-semibold transition-colors ${
              method === m ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {m === "CASH" ? "Cash" : m === "UPI" ? "UPI" : "Card"}
          </button>
        ))}
      </div>
      <label className="block text-sm font-medium text-slate-700">
        {method === "CASH" ? "Cash received (₹)" : "Amount paid (₹)"}
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${INPUT} mt-1 tabular-nums`} />
      </label>
      {change > 0 && (
        <p className="amb-fade-in text-sm text-amber-900">
          {formatMinor(owedMinor)} settles everything; give {formatMinor(change)} change.
        </p>
      )}
      {over && <p className="amb-fade-in text-sm text-rose-700">More than the {formatMinor(owedMinor)} owed — refused for UPI and card.</p>}
      {method !== "CASH" && (
        <label className="block text-sm font-medium text-slate-700">
          {method === "UPI" ? "UPI reference" : "Card slip number"}
          <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} className={`${INPUT} mt-1`} />
        </label>
      )}
      <button type="submit" disabled={busy || over} aria-busy={busy} className={`${buttonClass("primary")} amb-press w-full justify-center`}>
        <HandCoins aria-hidden="true" className="h-4 w-4" />
        {busy ? "Recording…" : "Record payment"}
      </button>
    </form>
  );
}
