"use client";

import { useActionState, useState } from "react";
import { CalendarOff } from "lucide-react";
import { buttonClass } from "../../_components/ui";
import { leaveAction, type LeaveState } from "./actions";

const IDLE: LeaveState = { status: "idle" };
const INPUT =
  "amb-focus mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500";

function Message({ state }: { state: LeaveState }) {
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

/** Ask for leave, or mark days you can't work. Nothing blocks shifts until a manager approves. */
export function RequestLeave(props: { today: string; selfId: string; people: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(leaveAction, IDLE);
  const [halfDay, setHalfDay] = useState(false);
  return (
    <form action={action} key={state.nonce} className="grid gap-3 sm:grid-cols-6">
      <input type="hidden" name="intent" value="request" />
      <div className="sm:col-span-6">
        <Message state={state} />
      </div>
      {props.people.length > 1 && (
        <label className="text-sm font-medium text-slate-700 sm:col-span-2">
          Person
          <select name="userId" defaultValue={props.selfId} className={INPUT}>
            {props.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="text-sm font-medium text-slate-700 sm:col-span-2">
        Type
        <select name="kind" defaultValue="LEAVE" className={INPUT}>
          <option value="LEAVE">Leave</option>
          <option value="UNAVAILABLE">Can&apos;t work these days</option>
        </select>
      </label>
      <label className="text-sm font-medium text-slate-700">
        From
        <input name="fromDate" type="date" required min={props.today} className={INPUT} />
      </label>
      <label className="text-sm font-medium text-slate-700">
        To
        <input name="toDate" type="date" min={props.today} disabled={halfDay} className={`${INPUT} disabled:bg-slate-50 disabled:text-slate-400`} />
      </label>
      <label className="flex min-h-11 items-center gap-2 self-end text-sm font-medium text-slate-700 sm:col-span-2">
        <input
          name="halfDay"
          type="checkbox"
          checked={halfDay}
          onChange={(e) => setHalfDay(e.target.checked)}
          className="amb-focus h-5 w-5 rounded border-slate-300"
        />
        Half day (one date)
      </label>
      <label className="text-sm font-medium text-slate-700 sm:col-span-4">
        Reason
        <input name="reason" required minLength={3} maxLength={200} placeholder="Family function" className={INPUT} />
      </label>
      <div className="sm:col-span-6">
        <button type="submit" disabled={pending} aria-busy={pending} className={`${buttonClass("primary")} amb-press`}>
          <CalendarOff aria-hidden="true" className="h-4 w-4" />
          {pending ? "Sending…" : "Send request"}
        </button>
      </div>
    </form>
  );
}

export function DecideLeave({ id }: { id: string }) {
  const [state, action, pending] = useActionState(leaveAction, IDLE);
  if (state.status === "success") {
    return (
      <p role="status" className="amb-pop-in text-sm text-emerald-700">
        {state.message}
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="intent" value="decide" />
      <input type="hidden" name="id" value={id} />
      <label className="sr-only" htmlFor={`leave-note-${id}`}>
        Decision note
      </label>
      <input
        id={`leave-note-${id}`}
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

export function WithdrawLeave({ id }: { id: string }) {
  const [state, action, pending] = useActionState(leaveAction, IDLE);
  if (state.status === "success") return <span className="text-sm text-slate-600">Withdrawn</span>;
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="intent" value="cancel" />
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="amb-focus inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100"
      >
        Withdraw
      </button>
      {state.status === "error" && (
        <span role="alert" className="text-xs text-rose-700">
          {state.message}
        </span>
      )}
    </form>
  );
}
