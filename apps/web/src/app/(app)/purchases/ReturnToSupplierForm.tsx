"use client";

import { useActionState, useState } from "react";
import { Undo2 } from "lucide-react";
import { buttonClass, Card, CardHeader } from "../_components/ui";
import { returnToSupplierAction, type ReturnActionState } from "./returnActions";

const IDLE: ReturnActionState = { status: "idle" };

export interface ReturnableLine {
  id: string;
  name: string;
  sku: string;
  received: number;
  returnable: number;
}

/** Send some of a purchase back to its supplier. Stock leaves the store when it is saved. */
export function ReturnToSupplierForm({ receiptId, lines }: { receiptId: string; lines: ReturnableLine[] }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(returnToSupplierAction, IDLE);
  // A fresh key each time the form opens; kept across retries of that one return.
  const [key, setKey] = useState(() => crypto.randomUUID());
  // The form closes once the server has accepted this key.
  const done = state.status === "success" && state.key === key;
  const showForm = open && !done;
  const startReturn = () => {
    setKey(crypto.randomUUID());
    setOpen(true);
  };

  if (!lines.some((l) => l.returnable > 0)) return null;

  return (
    <div className="mt-6">
      {state.status === "success" && !showForm && (
        <p role="status" className="amb-pop-in mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {state.message}
        </p>
      )}
      {!showForm ? (
        <button type="button" onClick={startReturn} className={`${buttonClass("secondary")} amb-press`}>
          <Undo2 aria-hidden="true" className="h-4 w-4" />
          Return to supplier
        </button>
      ) : (
        <Card className="amb-pop-in">
          <CardHeader
            title="Return to supplier"
            subtitle="Enter how many of each item go back. Stock is taken out and the input GST on them is reversed."
          />
          <form action={formAction} className="space-y-4 px-5 pb-5" noValidate>
            <input type="hidden" name="receiptId" value={receiptId} />
            <input type="hidden" name="idempotencyKey" value={key} />
            {state.status === "error" && (
              <p role="alert" className="amb-pop-in rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {state.message}
              </p>
            )}
            <ul className="divide-y divide-slate-100">
              {lines.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{l.name}</span>
                    <span className="block text-xs text-slate-500">
                      <span className="font-mono">{l.sku}</span> · {l.returnable} of {l.received} can go back
                    </span>
                  </span>
                  <label className="text-xs font-medium text-slate-600">
                    <span className="sr-only">Quantity of {l.name} to return</span>
                    <input
                      name={`qty:${l.id}`}
                      type="number"
                      min={0}
                      max={l.returnable}
                      step={1}
                      inputMode="numeric"
                      disabled={l.returnable === 0}
                      placeholder="0"
                      className="amb-focus min-h-11 w-24 rounded-lg border border-slate-300 bg-white px-3 text-right text-sm tabular-nums disabled:bg-slate-50"
                    />
                  </label>
                </li>
              ))}
            </ul>
            <label className="block text-sm font-medium text-slate-700">
              Reason
              <input
                name="reason"
                required
                maxLength={200}
                placeholder="Damaged, wrong size, not ordered…"
                className="amb-focus mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm placeholder:text-slate-500"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className={buttonClass("secondary")}>
                Cancel
              </button>
              <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass("primary")}>
                {pending ? "Saving…" : "Record return"}
              </button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
