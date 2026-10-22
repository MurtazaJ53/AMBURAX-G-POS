"use client";

import { useActionState } from "react";
import { CalendarPlus, Send } from "lucide-react";
import { buttonClass, Card, CardHeader, StatusBadge } from "../../_components/ui";
import { planAction, type PlanState } from "./actions";

const IDLE: PlanState = { status: "idle" };
const INPUT = "amb-focus mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900";
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

/** E5: plan shifts up to 14 days ahead, then publish them to the team. */
export function ShiftPlanner(props: {
  plans: { id: string; name: string; startAt: string; endAt: string; breakMinutes: number; status: string }[];
  people: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(planAction, IDLE);
  const drafts = props.plans.filter((p) => p.status === "DRAFT").length;
  return (
    <Card>
      <CardHeader title="Plan shifts" subtitle="Up to 14 days ahead. Drafts are seen only by managers until published." />
      <div className="space-y-4 px-5 pb-5">
        {state.status !== "idle" && (
          <p
            role={state.status === "error" ? "alert" : "status"}
            className={`amb-pop-in rounded-lg px-3 py-2 text-sm ${state.status === "error" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"}`}
          >
            {state.message}
          </p>
        )}
        <form action={action} key={state.nonce} className="grid gap-3 sm:grid-cols-6">
          <input type="hidden" name="intent" value="add" />
          <label className="text-sm font-medium text-slate-700 sm:col-span-2">
            Person
            <select name="userId" required className={INPUT}>
              {props.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700">
            Date
            <input name="date" type="date" required className={INPUT} />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Start
            <input name="start" type="time" required defaultValue="10:00" className={INPUT} />
          </label>
          <label className="text-sm font-medium text-slate-700">
            End
            <input name="end" type="time" required defaultValue="19:00" className={INPUT} />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Break (min)
            <input name="breakMinutes" type="number" min={0} defaultValue={60} className={INPUT} />
          </label>
          <div className="sm:col-span-6">
            <button type="submit" disabled={pending} aria-busy={pending} className={`${buttonClass("primary")} amb-press`}>
              <CalendarPlus aria-hidden="true" className="h-4 w-4" />
              Add shift
            </button>
          </div>
        </form>

        {props.plans.length === 0 ? (
          <p className="text-sm text-slate-600">No shifts planned in the next 14 days.</p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {props.plans.map((p) => (
              <li key={p.id} className="amb-line-in flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  <span className="font-medium text-slate-900">{p.name}</span>
                  <span className="ml-2 text-slate-600">
                    {day(p.startAt)} · {time(p.startAt)}–{time(p.endAt)}
                    {p.breakMinutes > 0 && ` · ${p.breakMinutes} min break`}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <StatusBadge tone={p.status === "PUBLISHED" ? "success" : "neutral"}>{p.status === "PUBLISHED" ? "Published" : "Draft"}</StatusBadge>
                  <form action={action}>
                    <input type="hidden" name="intent" value="cancel" />
                    <input type="hidden" name="shiftId" value={p.id} />
                    <button
                      type="submit"
                      disabled={pending}
                      aria-label={`Cancel ${p.name}'s shift on ${day(p.startAt)}`}
                      className="amb-focus inline-flex min-h-11 items-center rounded-lg px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                    >
                      Cancel
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        )}
        {drafts > 0 && (
          <form action={action}>
            <input type="hidden" name="intent" value="publish" />
            <button type="submit" disabled={pending} className={`${buttonClass("primary")} amb-press`}>
              <Send aria-hidden="true" className="h-4 w-4" />
              Publish {drafts} {drafts === 1 ? "shift" : "shifts"}
            </button>
          </form>
        )}
      </div>
    </Card>
  );
}
