"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import type { SupplierRow } from "@/server/purchasing/suppliers";
import { buttonClass } from "../_components/ui";
import { saveSupplierAction, toggleSupplierActiveAction, type SupplierActionState } from "./actions";

const IDLE: SupplierActionState = { status: "idle" };

type FieldName = "name" | "contactName" | "phone" | "email" | "gstin" | "city";

const FIELDS: { name: FieldName; label: string; type?: string; placeholder?: string }[] = [
  { name: "name", label: "Supplier name", placeholder: "Sharma Textiles" },
  { name: "contactName", label: "Contact person" },
  { name: "phone", label: "Phone", type: "tel", placeholder: "98765 43210" },
  { name: "email", label: "Email", type: "email" },
  { name: "gstin", label: "GSTIN", placeholder: "27ABCDE1234F1Z5" },
  { name: "city", label: "City" },
];

const INPUT =
  "amb-focus block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500 transition-colors focus:border-sky-600";

/** Add or edit one supplier, in a dialog so the list stays in view behind it. */
export function SupplierDialog({ supplier, onClose }: { supplier: SupplierRow | null; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(saveSupplierAction, IDLE);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstField.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (state.status === "success") onClose();
  }, [state, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div aria-hidden="true" className="amb-fade-in fixed inset-0 bg-slate-900/50" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="supplier-dialog-title"
        className="amb-pop-in relative z-10 max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-white shadow-2xl sm:rounded-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 id="supplier-dialog-title" className="text-base font-semibold text-slate-900">
            {supplier ? `Edit ${supplier.name}` : "Add supplier"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="amb-focus flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <form action={formAction} className="space-y-4 px-5 py-4" noValidate>
          {supplier && <input type="hidden" name="supplierId" value={supplier.id} />}
          {state.status === "error" && (
            <p role="alert" className="amb-pop-in rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {state.message}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {FIELDS.map((f, i) => {
              const id = `supplier-${f.name}`;
              const invalid = state.status === "error" && state.field === f.name;
              return (
                <div key={f.name} className={f.name === "name" ? "sm:col-span-2" : undefined}>
                  <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
                    {f.label}
                    {f.name !== "name" && <span className="font-normal text-slate-500"> (optional)</span>}
                  </label>
                  <input
                    ref={i === 0 ? firstField : undefined}
                    id={id}
                    name={f.name}
                    type={f.type ?? "text"}
                    required={f.name === "name"}
                    defaultValue={supplier?.[f.name] ?? ""}
                    placeholder={f.placeholder}
                    aria-invalid={invalid || undefined}
                    className={`${INPUT} ${invalid ? "border-rose-500" : ""}`}
                  />
                </div>
              );
            })}
          </div>
          <div>
            <label htmlFor="supplier-notes" className="mb-1 block text-sm font-medium text-slate-700">
              Notes <span className="font-normal text-slate-500">(optional)</span>
            </label>
            <textarea
              id="supplier-notes"
              name="notes"
              rows={3}
              maxLength={500}
              defaultValue={supplier?.notes ?? ""}
              className={`${INPUT} py-2`}
            />
          </div>
          <p className="text-xs text-slate-500">
            GSTIN is checked for shape only. AMBURAX does not verify it with the GST network.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className={buttonClass("secondary")}>
              Cancel
            </button>
            <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass("primary")}>
              {pending ? "Saving…" : supplier ? "Save changes" : "Add supplier"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function AddSupplierButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${buttonClass("primary")} amb-press`}>
        <Plus aria-hidden="true" className="h-4 w-4" />
        Add supplier
      </button>
      {open && <SupplierDialog supplier={null} onClose={() => setOpen(false)} />}
    </>
  );
}

export function SupplierRowActions({ supplier }: { supplier: SupplierRow }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(toggleSupplierActiveAction, IDLE);
  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Edit ${supplier.name}`}
        className="amb-focus min-h-11 rounded-lg px-3 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50"
      >
        Edit
      </button>
      <form action={formAction}>
        <input type="hidden" name="supplierId" value={supplier.id} />
        <input type="hidden" name="isActive" value={supplier.isActive ? "false" : "true"} />
        <button
          type="submit"
          disabled={pending}
          aria-label={`${supplier.isActive ? "Deactivate" : "Reactivate"} ${supplier.name}`}
          className="amb-focus min-h-11 rounded-lg px-3 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-60"
        >
          {supplier.isActive ? "Deactivate" : "Reactivate"}
        </button>
      </form>
      {state.status === "error" && (
        <span role="alert" className="text-xs text-rose-700">
          {state.message}
        </span>
      )}
      {editing && <SupplierDialog supplier={supplier} onClose={() => setEditing(false)} />}
    </div>
  );
}
