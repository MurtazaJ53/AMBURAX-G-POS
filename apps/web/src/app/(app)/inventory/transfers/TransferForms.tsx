"use client";

import { useActionState, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { buttonClass, Card, CardHeader } from "../../_components/ui";
import {
  cancelTransferAction,
  receiveTransferAction,
  sendTransferAction,
  type TransferActionState,
} from "./actions";

const IDLE: TransferActionState = { status: "idle" };
const INPUT =
  "amb-focus block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500";

function Feedback({ state }: { state: TransferActionState }) {
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

/** Send stock from this store to another. Stock leaves this store when it is sent. */
export function NewTransferForm({ stores }: { stores: { id: string; name: string; code: string }[] }) {
  const [state, formAction, pending] = useActionState(sendTransferAction, IDLE);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const nextId = useRef(2);
  const [rows, setRows] = useState([{ id: 1, sku: "", quantity: "" }]);
  const lines = JSON.stringify(rows.map((r) => ({ sku: r.sku.trim(), quantity: Number(r.quantity) })));
  const update = (id: number, patch: Partial<{ sku: string; quantity: string }>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="lines" value={lines} />
      <Feedback state={state} />
      <Card>
        <CardHeader title="Send to" />
        <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">
            Receiving store
            <select name="toStoreId" required defaultValue="" className={`${INPUT} mt-1`}>
              <option value="" disabled>
                Choose a store
              </option>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Note <span className="font-normal text-slate-500">(optional)</span>
            <input name="note" maxLength={300} placeholder="Restock for the weekend" className={`${INPUT} mt-1`} />
          </label>
        </div>
      </Card>
      <Card>
        <CardHeader title="Items" subtitle="These units leave this store as soon as you send." />
        <ul className="space-y-2 px-5">
          {rows.map((r, i) => (
            <li key={r.id} className="amb-fade-in flex items-center gap-2">
              <input
                aria-label={`Line ${i + 1} SKU`}
                value={r.sku}
                onChange={(e) => update(r.id, { sku: e.target.value })}
                placeholder="SKU"
                className={`${INPUT} flex-1`}
              />
              <input
                aria-label={`Line ${i + 1} quantity`}
                inputMode="numeric"
                value={r.quantity}
                onChange={(e) => update(r.id, { quantity: e.target.value })}
                placeholder="Qty"
                className={`${INPUT} w-24 tabular-nums`}
              />
              <button
                type="button"
                disabled={rows.length === 1}
                onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                aria-label={`Remove line ${i + 1}`}
                className="amb-focus flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
        <div className="px-5 py-4">
          <button
            type="button"
            onClick={() => setRows((rs) => [...rs, { id: nextId.current++, sku: "", quantity: "" }])}
            className={buttonClass("secondary")}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Add line
          </button>
        </div>
      </Card>
      <div className="flex justify-end">
        <button type="submit" disabled={pending} aria-busy={pending} className={`${buttonClass("primary")} amb-press`}>
          {pending ? "Sending…" : "Send transfer"}
        </button>
      </div>
    </form>
  );
}

/** Receive what arrived, line by line. Defaults to everything that was sent. */
export function ReceiveTransferForm({
  transferId,
  lines,
}: {
  transferId: string;
  lines: { id: string; name: string; sku: string; quantity: number }[];
}) {
  const [state, formAction, pending] = useActionState(receiveTransferAction, IDLE);
  if (state.status === "success") return <Feedback state={state} />;
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="transferId" value={transferId} />
      <Feedback state={state} />
      <ul className="divide-y divide-slate-100">
        {lines.map((l) => (
          <li key={l.id} className="flex items-center gap-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-slate-900">{l.name}</span>
              <span className="block text-xs text-slate-500">
                <span className="font-mono">{l.sku}</span> · {l.quantity} sent
              </span>
            </span>
            <label className="text-xs text-slate-600">
              <span className="sr-only">Units of {l.name} that arrived</span>
              <input
                name={`recv:${l.id}`}
                type="number"
                min={0}
                max={l.quantity}
                step={1}
                defaultValue={l.quantity}
                className="amb-focus min-h-11 w-24 rounded-lg border border-slate-300 px-3 text-right text-sm tabular-nums"
              />
            </label>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">Lower a number if fewer arrived. The shortfall is recorded on the transfer.</p>
      <div className="flex justify-end">
        <button type="submit" disabled={pending} aria-busy={pending} className={`${buttonClass("primary")} amb-press`}>
          {pending ? "Receiving…" : "Receive into this store"}
        </button>
      </div>
    </form>
  );
}

export function CancelTransferButton({ transferId }: { transferId: string }) {
  const [state, formAction, pending] = useActionState(cancelTransferAction, IDLE);
  if (state.status === "success") return <Feedback state={state} />;
  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input type="hidden" name="transferId" value={transferId} />
      <Feedback state={state} />
      <button
        type="submit"
        disabled={pending}
        className="amb-focus min-h-11 rounded-lg border border-rose-300 px-4 text-sm font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-60"
      >
        {pending ? "Cancelling…" : "Cancel transfer"}
      </button>
    </form>
  );
}
