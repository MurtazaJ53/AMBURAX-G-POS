"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Plus, X, ShoppingCart, ArrowRight } from "lucide-react";
import type { LeadStage } from "@prisma/client";
import type { LeadRow } from "@/server/b2b/leads";
import { buttonClass } from "../_components/ui";
import { moveLeadAction, saveLeadAction, convertLeadAction, type LeadActionState } from "./actions";

const IDLE: LeadActionState = { status: "idle" };

export const STAGE_OPTIONS: { id: LeadStage; label: string }[] = [
  { id: "NEW", label: "New" },
  { id: "CONTACTED", label: "Contacted" },
  { id: "QUALIFIED", label: "Qualified" },
  { id: "WON", label: "Won" },
  { id: "LOST", label: "Lost" },
];

type FieldName = "company" | "contactName" | "phone" | "email" | "city" | "source";

const FIELDS: { name: FieldName; label: string; type?: string; placeholder?: string }[] = [
  { name: "company", label: "Company", placeholder: "Mehta Garments" },
  { name: "contactName", label: "Contact person" },
  { name: "phone", label: "Phone", type: "tel" },
  { name: "email", label: "Email", type: "email" },
  { name: "city", label: "City" },
  { name: "source", label: "Source", placeholder: "Trade fair, referral…" },
];

const INPUT =
  "amb-focus block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500 transition-colors focus:border-sky-600";

function LeadDialog({ lead, onClose }: { lead: LeadRow | null; onClose: () => void }) {
  const [state, formAction, pending] = useActionState(saveLeadAction, IDLE);
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
        aria-labelledby="lead-dialog-title"
        className="amb-pop-in relative z-10 max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-white shadow-2xl sm:rounded-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 id="lead-dialog-title" className="text-base font-semibold text-slate-900">
            {lead ? `Edit ${lead.company}` : "Add lead"}
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
          {lead && <input type="hidden" name="leadId" value={lead.id} />}
          {state.status === "error" && (
            <p role="alert" className="amb-pop-in rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {state.message}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {FIELDS.map((f, i) => {
              const id = `lead-${f.name}`;
              const invalid = state.status === "error" && state.field === f.name;
              return (
                <div key={f.name} className={f.name === "company" ? "sm:col-span-2" : undefined}>
                  <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-700">
                    {f.label}
                    {f.name !== "company" && <span className="font-normal text-slate-500"> (optional)</span>}
                  </label>
                  <input
                    ref={i === 0 ? firstField : undefined}
                    id={id}
                    name={f.name}
                    type={f.type ?? "text"}
                    required={f.name === "company"}
                    defaultValue={lead?.[f.name] ?? ""}
                    placeholder={f.placeholder}
                    aria-invalid={invalid || undefined}
                    className={`${INPUT} ${invalid ? "border-rose-500" : ""}`}
                  />
                </div>
              );
            })}
            <div>
              <label htmlFor="lead-stage" className="mb-1 block text-sm font-medium text-slate-700">
                Stage
              </label>
              <select id="lead-stage" name="stage" defaultValue={lead?.stage ?? "NEW"} className={INPUT}>
                {STAGE_OPTIONS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="lead-notes" className="mb-1 block text-sm font-medium text-slate-700">
              Notes <span className="font-normal text-slate-500">(optional)</span>
            </label>
            <textarea
              id="lead-notes"
              name="notes"
              rows={3}
              maxLength={1000}
              defaultValue={lead?.notes ?? ""}
              className={`${INPUT} py-2`}
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className={buttonClass("secondary")}>
              Cancel
            </button>
            <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass("primary")}>
              {pending ? "Saving…" : lead ? "Save changes" : "Add lead"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function AddLeadButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${buttonClass("primary")} amb-press`}>
        <Plus aria-hidden="true" className="h-4 w-4" />
        Add lead
      </button>
      {open && <LeadDialog lead={null} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Edit and stage controls on one lead card. */
export function LeadCardActions({ lead }: { lead: LeadRow }) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(moveLeadAction, IDLE);
  const [convertState, convertAction, convertPending] = useActionState(convertLeadAction, IDLE);
  const selectId = `stage-${lead.id}`;
  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-2">
        <form action={formAction} className="flex min-w-0 flex-1 items-center gap-1">
          <input type="hidden" name="leadId" value={lead.id} />
          <label htmlFor={selectId} className="sr-only">
            Stage for {lead.company}
          </label>
          <select
            id={selectId}
            name="stage"
            defaultValue={lead.stage}
            disabled={pending || convertPending}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="amb-focus min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-800"
          >
            {STAGE_OPTIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </form>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${lead.company}`}
          className="amb-focus min-h-11 rounded-lg px-3 text-sm font-semibold text-sky-700 transition-colors hover:bg-sky-50"
        >
          Edit
        </button>
      </div>

      {/* Convert to Order Action (Phase 9 B2B Pipeline) */}
      <form action={convertAction}>
        <input type="hidden" name="leadId" value={lead.id} />
        <button
          type="submit"
          disabled={convertPending || lead.stage === "WON"}
          className={`flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 px-3 text-xs font-semibold transition-all ${
            lead.stage === "WON"
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : "bg-slate-900 text-white hover:bg-slate-800 active:scale-[0.99]"
          }`}
        >
          <ShoppingCart className="h-3.5 w-3.5" />
          {convertPending ? "Generating Order..." : lead.stage === "WON" ? "Converted to Trade Order" : "Convert to Wholesale Order"}
        </button>
      </form>

      {convertState.status !== "idle" && (
        <p
          role={convertState.status === "error" ? "alert" : "status"}
          className={`text-[11px] font-medium ${convertState.status === "error" ? "text-rose-700" : "text-emerald-700"}`}
        >
          {convertState.message}
        </p>
      )}

      {state.status === "error" && (
        <span role="alert" className="block text-xs text-rose-700">
          {state.message}
        </span>
      )}
      {editing && <LeadDialog lead={lead} onClose={() => setEditing(false)} />}
    </div>
  );
}
