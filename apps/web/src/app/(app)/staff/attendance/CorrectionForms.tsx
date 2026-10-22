"use client";

import { useActionState, useState } from "react";
import { buttonClass } from "../../_components/ui";
import { decideCorrectionAction, requestCorrectionAction, type CorrectionState } from "./actions";

const IDLE: CorrectionState = { status: "idle" };
const INPUT =
  "amb-focus mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500";

function Message({ state }: { state: CorrectionState }) {
  if (state.status === "idle") return null;
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={`amb-pop-in rounded-lg px-3 py-2 text-sm ${state.status === "error" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"}`}
    >
      {state.message}
    </p>
  );
}

/** E5: ask for a missing or wrong punch to be corrected. It changes nothing until a manager approves. */
export function RequestCorrection(props: {
  date: string;
  people: { id: string; name: string }[];
  selfId: string;
  punches: { id: string; label: string; userId: string }[];
}) {
  const [state, action, pending] = useActionState(requestCorrectionAction, IDLE);
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState(props.selfId);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonClass("secondary")}>
        Request a correction
      </button>
    );
  }
  return (
    <form action={action} className="amb-pop-in grid w-full gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Message state={state} />
      </div>
      {props.people.length > 1 && (
        <label className="text-sm font-medium text-slate-700">
          Person
          <select name="userId" value={userId} onChange={(e) => setUserId(e.target.value)} className={INPUT}>
            {props.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="text-sm font-medium text-slate-700">
        Punch
        <select name="logType" defaultValue="IN" className={INPUT}>
          <option value="IN">Clock in</option>
          <option value="OUT">Clock out</option>
        </select>
      </label>
      <label className="text-sm font-medium text-slate-700">
        Date
        <input name="date" type="date" required defaultValue={props.date} className={INPUT} />
      </label>
      <label className="text-sm font-medium text-slate-700">
        Correct time
        <input name="time" type="time" required className={INPUT} />
      </label>
      <label className="text-sm font-medium text-slate-700 sm:col-span-2">
        Replaces <span className="font-normal text-slate-500">(optional — leave empty to add a missing punch)</span>
        <select name="originalCheckinId" defaultValue="" className={INPUT}>
          <option value="">Nothing — add a missing punch</option>
          {props.punches
            .filter((p) => p.userId === userId)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
        </select>
      </label>
      <label className="text-sm font-medium text-slate-700 sm:col-span-2">
        Reason
        <input name="reason" required minLength={3} maxLength={200} placeholder="Forgot to clock out" className={INPUT} />
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" disabled={pending} aria-busy={pending} className={`${buttonClass("primary")} amb-press`}>
          {pending ? "Sending…" : "Send request"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={buttonClass("secondary")}>
          Close
        </button>
      </div>
    </form>
  );
}

export function DecideCorrection({ id }: { id: string }) {
  const [state, action, pending] = useActionState(decideCorrectionAction, IDLE);
  if (state.status === "success") {
    return (
      <p role="status" className="amb-pop-in text-sm text-emerald-700">
        {state.message}
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="id" value={id} />
      <label className="sr-only" htmlFor={`note-${id}`}>
        Decision note
      </label>
      <input
        id={`note-${id}`}
        name="note"
        required
        minLength={3}
        maxLength={200}
        placeholder="Note"
        className="amb-focus min-h-11 w-36 rounded-lg border border-slate-300 px-3 text-sm"
      />
      <button type="submit" name="decision" value="APPROVE" disabled={pending} className={buttonClass("primary")}>
        Approve
      </button>
      <button
        type="submit"
        name="decision"
        value="REJECT"
        disabled={pending}
        className="amb-focus inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50"
      >
        Reject
      </button>
      {state.status === "error" && (
        <span role="alert" className="w-full text-right text-xs text-rose-700">
          {state.message}
        </span>
      )}
    </form>
  );
}
