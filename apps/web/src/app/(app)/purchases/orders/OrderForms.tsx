"use client";

import { useActionState, useRef, useState } from "react";
import { PackageCheck, Plus, Trash2, XCircle } from "lucide-react";
import { formatMinor } from "@/server/sales/saleTotals";
import { buttonClass, Card, CardHeader } from "../../_components/ui";
import { cancelOrderAction, createOrderAction, receiveOrderAction, type OrderActionState } from "./actions";
import { GrnInwardScanner } from "./GrnInwardScanner";

const IDLE: OrderActionState = { status: "idle" };
const GST_RATES = [0, 500, 1200, 1800, 2800];
const INPUT =
  "amb-focus block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500";
const DANGER =
  "amb-focus amb-press inline-flex min-h-11 items-center gap-2 rounded-lg bg-rose-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-rose-700 disabled:opacity-60";

function toMinor(raw: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw.replaceAll(",", "").trim());
  if (!m) return Number.NaN;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
}

function Alert({ state }: { state: OrderActionState }) {
  if (state.status === "idle") return null;
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

interface Row {
  id: number;
  sku: string;
  quantity: string;
  cost: string;
  gstRateBp: number;
}

/** Place an order with a supplier (screen 47). Cost per unit excludes GST, as on receipts. */
export function NewOrderForm({ suppliers, minDate }: { suppliers: { id: string; name: string }[]; minDate: string }) {
  const [state, formAction, pending] = useActionState(createOrderAction, IDLE);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const nextId = useRef(2);
  const [rows, setRows] = useState<Row[]>([{ id: 1, sku: "", quantity: "", cost: "", gstRateBp: 500 }]);
  const update = (id: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const priced = rows.map((r) => {
    const qty = Number(r.quantity);
    const cost = toMinor(r.cost);
    const ok = Number.isInteger(qty) && qty > 0 && Number.isFinite(cost);
    const taxable = ok ? qty * cost : 0;
    return { ...r, ok, taxable, tax: ok ? Math.round((taxable * r.gstRateBp) / 10_000) : 0, qty, costMinor: cost };
  });
  const taxable = priced.reduce((s, r) => s + r.taxable, 0);
  const tax = priced.reduce((s, r) => s + r.tax, 0);
  const linesJson = JSON.stringify(
    priced.map((r) => ({ sku: r.sku.trim(), quantity: r.qty, unitCostMinor: r.costMinor, gstRateBp: r.gstRateBp })),
  );

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="lines" value={linesJson} />
      <Alert state={state} />

      <Card>
        <CardHeader title="Order" />
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">
            Supplier
            <select name="supplierId" required defaultValue="" className={`${INPUT} mt-1`}>
              <option value="" disabled>
                Choose a supplier
              </option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Expected by
            <input name="expectedDate" type="date" required min={minDate} defaultValue={minDate} className={`${INPUT} mt-1`} />
          </label>
        </div>
      </Card>

      <Card>
        <CardHeader title="Items" subtitle="Cost per unit excludes GST. Nothing changes in stock until the goods arrive." />
        <div className="overflow-x-auto px-5">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                <th className="py-2 pr-2">SKU</th>
                <th className="w-24 py-2 pr-2">Qty</th>
                <th className="w-36 py-2 pr-2">Cost / unit (₹)</th>
                <th className="w-28 py-2 pr-2">GST</th>
                <th className="w-32 py-2 pr-2 text-right">Line, excl. GST</th>
                <th className="w-12 py-2">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {priced.map((r, i) => (
                <tr key={r.id} className="amb-fade-in border-t border-slate-100">
                  <td className="py-2 pr-2">
                    <input aria-label={`Line ${i + 1} SKU`} value={r.sku} onChange={(e) => update(r.id, { sku: e.target.value })} className={INPUT} />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      aria-label={`Line ${i + 1} quantity`}
                      inputMode="numeric"
                      value={r.quantity}
                      onChange={(e) => update(r.id, { quantity: e.target.value })}
                      className={`${INPUT} tabular-nums`}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      aria-label={`Line ${i + 1} cost per unit in rupees, excluding GST`}
                      inputMode="decimal"
                      value={r.cost}
                      onChange={(e) => update(r.id, { cost: e.target.value })}
                      className={`${INPUT} tabular-nums`}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <select
                      aria-label={`Line ${i + 1} GST rate`}
                      value={r.gstRateBp}
                      onChange={(e) => update(r.id, { gstRateBp: Number(e.target.value) })}
                      className={INPUT}
                    >
                      {GST_RATES.map((g) => (
                        <option key={g} value={g}>
                          {g / 100}%
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums text-slate-900">{r.ok ? formatMinor(r.taxable) : "—"}</td>
                  <td className="py-2">
                    <button
                      type="button"
                      disabled={rows.length === 1}
                      onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                      aria-label={`Remove line ${i + 1}`}
                      className="amb-focus flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
          <button
            type="button"
            onClick={() => setRows((rs) => [...rs, { id: nextId.current++, sku: "", quantity: "", cost: "", gstRateBp: 500 }])}
            className={buttonClass("secondary")}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Add line
          </button>
          <dl className="min-w-[220px] space-y-1 text-sm">
            <div className="flex justify-between gap-6">
              <dt className="text-slate-600">Order value</dt>
              <dd className="tabular-nums text-slate-900">{formatMinor(taxable)}</dd>
            </div>
            <div className="flex justify-between gap-6">
              <dt className="text-slate-600">Expected GST</dt>
              <dd className="tabular-nums text-slate-900">{formatMinor(tax)}</dd>
            </div>
            <div className="flex justify-between gap-6 border-t border-slate-200 pt-1 font-semibold">
              <dt className="text-slate-900">Total</dt>
              <dd className="tabular-nums text-slate-900">{formatMinor(taxable + tax)}</dd>
            </div>
          </dl>
        </div>
      </Card>

      <label className="block text-sm font-medium text-slate-700">
        Notes for the supplier <span className="font-normal text-slate-500">(optional)</span>
        <textarea name="notes" rows={2} maxLength={500} className={`${INPUT} mt-1 py-2`} />
      </label>

      <div className="flex justify-end">
        <button type="submit" disabled={pending} aria-busy={pending} className={`${buttonClass("primary")} amb-press`}>
          {pending ? "Placing…" : "Place order"}
        </button>
      </div>
    </form>
  );
}

export interface ReceiveLine {
  id: string;
  name: string;
  sku: string;
  due: number;
}

/** Receive what arrived against an order (screen 48). Quantities start at what is still due. */
export function ReceiveOrderForm({ orderId, lines }: { orderId: string; lines: ReceiveLine[] }) {
  const [state, formAction, pending] = useActionState(receiveOrderAction, IDLE);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [counts, setCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(lines.map((l) => [l.id, l.due]))
  );

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <Alert state={state} />

      {/* Interactive Barcode Inward Verification Scanner */}
      <GrnInwardScanner
        lines={lines}
        counts={counts}
        onCountUpdate={(lineId, val) => setCounts((c) => ({ ...c, [lineId]: val }))}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">
          Supplier invoice number
          <input name="supplierInvoiceNo" required maxLength={60} className={`${INPUT} mt-1`} />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Invoice date <span className="font-normal text-slate-500">(optional)</span>
          <input name="supplierInvoiceDate" type="date" className={`${INPUT} mt-1`} />
        </label>
      </div>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {lines.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="min-w-0">
              <span className="block truncate font-medium text-slate-900">{l.name}</span>
              <span className="font-mono text-xs text-slate-500">
                {l.sku} · {l.due} due
              </span>
            </span>
            <label className="sr-only" htmlFor={`rq-${l.id}`}>
              Arrived: {l.name}
            </label>
            <input
              id={`rq-${l.id}`}
              name={`qty:${l.id}`}
              inputMode="numeric"
              value={counts[l.id] ?? l.due}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                setCounts((c) => ({ ...c, [l.id]: isNaN(val) ? 0 : val }));
              }}
              className="amb-focus min-h-11 w-20 rounded-lg border border-slate-300 px-2 text-right tabular-nums"
            />
          </li>
        ))}
      </ul>
      <button type="submit" disabled={pending} aria-busy={pending} className={`${buttonClass("primary")} amb-press w-full justify-center`}>
        <PackageCheck aria-hidden="true" className="h-4 w-4" />
        {pending ? "Receiving…" : "Receive into stock"}
      </button>
      <p className="text-xs text-slate-500">Cost and GST come from the order. Receiving more than is due is refused.</p>
    </form>
  );
}

export function CancelOrderButton({ orderId }: { orderId: string }) {
  const [state, formAction, pending] = useActionState(cancelOrderAction, IDLE);
  const [confirming, setConfirming] = useState(false);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="orderId" value={orderId} />
      <Alert state={state} />
      {confirming ? (
        <div className="amb-pop-in flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-700">Cancel this order? Tell the supplier separately.</span>
          <button type="submit" disabled={pending} className={DANGER}>
            {pending ? "Cancelling…" : "Yes, cancel"}
          </button>
          <button type="button" onClick={() => setConfirming(false)} className={buttonClass("secondary")}>
            Keep it
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={buttonClass("secondary")}>
          <XCircle aria-hidden="true" className="h-4 w-4" />
          Cancel order
        </button>
      )}
    </form>
  );
}
