"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { PackagePlus, Save } from "lucide-react";
import type { ReplenishmentRow } from "@/server/inventory/replenishment";
import { buttonClass } from "../../_components/ui";
import { replenishAction, type ReplenishActionState } from "./actions";

const IDLE: ReplenishActionState = { status: "idle" };
const NUM = "amb-focus min-h-11 w-20 rounded-lg border border-slate-300 px-2 text-right tabular-nums";
const digits = (v: string) => v.replace(/[^\d]/g, "");

/**
 * The replenishment sheet. Each row: what is on hand, its reorder level and quantity (editable),
 * and how many to request (pre-filled with the suggestion when a level is set).
 */
export function ReplenishForm({ rows, canEdit, formatCost }: { rows: ReplenishmentRow[]; canEdit: boolean; formatCost: Record<string, string> }) {
  const [state, formAction, pending] = useActionState(replenishAction, IDLE);
  // A fresh key after each successful request so the next one is new, while a double-click is not.
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [lastState, setLastState] = useState(state);
  const [orders, setOrders] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.variantId, r.suggestedQty ? String(r.suggestedQty) : ""])),
  );
  if (state !== lastState) {
    setLastState(state);
    if (state.status === "success" && state.message?.startsWith("Request sent")) {
      setRequestKey(crypto.randomUUID());
      setOrders({});
    }
  }
  const toOrder = Object.values(orders).filter((v) => v !== "" && Number(v) > 0).length;

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="requestKey" value={requestKey} />
      {state.status !== "idle" && (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={`amb-pop-in rounded-lg px-3 py-2 text-sm ${
            state.status === "error" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"
          }`}
        >
          {state.message}
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[760px] text-sm">
          <caption className="sr-only">Items at or below their reorder level</caption>
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-600">
            <tr>
              <th scope="col" className="px-4 py-3">Item</th>
              <th scope="col" className="px-4 py-3 text-right">On hand</th>
              <th scope="col" className="px-4 py-3 text-right">Reorder at</th>
              <th scope="col" className="px-4 py-3 text-right">Reorder qty</th>
              <th scope="col" className="px-4 py-3">Last bought</th>
              <th scope="col" className="px-4 py-3 text-right">Request</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const label = `${r.productName} ${r.sku}`;
              return (
                <tr key={r.variantId}>
                  <td className="px-4 py-2.5">
                    <input type="hidden" name="variant" value={r.variantId} />
                    <span className="font-medium text-slate-900">{r.productName}</span>
                    <span className="block font-mono text-xs text-slate-500">
                      {[r.sku, r.size, r.colour].filter(Boolean).join(" · ")}
                    </span>
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right font-semibold tabular-nums ${
                      r.quantity <= 0 ? "text-rose-700" : "text-amber-800"
                    }`}
                  >
                    {r.quantity}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <label className="sr-only" htmlFor={`level-${r.variantId}`}>Reorder level for {label}</label>
                    <input
                      id={`level-${r.variantId}`}
                      name={`level:${r.variantId}`}
                      inputMode="numeric"
                      defaultValue={r.reorderLevel ?? ""}
                      placeholder="10"
                      disabled={!canEdit}
                      onInput={(e) => (e.currentTarget.value = digits(e.currentTarget.value))}
                      className={`${NUM} placeholder:text-slate-400`}
                    />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <label className="sr-only" htmlFor={`rqty-${r.variantId}`}>Reorder quantity for {label}</label>
                    <input
                      id={`rqty-${r.variantId}`}
                      name={`rqty:${r.variantId}`}
                      inputMode="numeric"
                      defaultValue={r.reorderQty ?? ""}
                      disabled={!canEdit}
                      onInput={(e) => (e.currentTarget.value = digits(e.currentTarget.value))}
                      className={NUM}
                    />
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">
                    {r.lastSupplier ? (
                      <>
                        <span className="block truncate">{r.lastSupplier}</span>
                        <span className="block text-xs text-slate-500">{formatCost[r.variantId]} each, excl. GST</span>
                      </>
                    ) : (
                      <span className="text-slate-500">Never received</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <label className="sr-only" htmlFor={`order-${r.variantId}`}>Quantity to request for {label}</label>
                    <input
                      id={`order-${r.variantId}`}
                      name={`order:${r.variantId}`}
                      inputMode="numeric"
                      value={orders[r.variantId] ?? ""}
                      disabled={!canEdit}
                      onChange={(e) => setOrders((o) => ({ ...o, [r.variantId]: digits(e.target.value) }))}
                      className={`${NUM} border-sky-300 bg-sky-50/50`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canEdit ? (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="min-w-[240px] flex-1 text-sm font-medium text-slate-700">
            Note for purchasing <span className="font-normal text-slate-500">(optional)</span>
            <input
              name="note"
              maxLength={140}
              placeholder="Diwali stock-up"
              className="amb-focus mt-1 block min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm placeholder:text-slate-500"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/purchases/orders/new"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-colors"
            >
              🛒 Create Direct PO
            </Link>
            <button type="submit" name="intent" value="levels" disabled={pending} className={buttonClass("secondary")}>
              <Save aria-hidden="true" className="h-4 w-4" />
              Save levels
            </button>
            <button
              type="submit"
              name="intent"
              value="request"
              disabled={pending || toOrder === 0}
              aria-busy={pending}
              className={`${buttonClass("primary")} amb-press`}
            >
              <PackagePlus aria-hidden="true" className="h-4 w-4" />
              {pending ? "Sending…" : `Request ${toOrder} ${toOrder === 1 ? "item" : "items"}`}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-600">Only the owner, store manager or inventory manager can change levels or request stock.</p>
      )}
      <p className="text-xs text-slate-500">
        Leave both reorder fields blank to use the shared low-stock line (10 units). Levels and requests are kept in
        Accounting: levels on the item&apos;s reorder table for this store&apos;s warehouse, requests as draft Material
        Requests that purchasing turns into orders.
      </p>
    </form>
  );
}
