"use client";

import { useActionState, useState } from "react";
import type { CountSheetRow } from "@/server/inventory/countSheet";
import { buttonClass } from "../../_components/ui";
import { submitCountAction, type CountActionState } from "./actions";

const IDLE: CountActionState = { status: "idle" };

/** The count sheet: type what is on the shelf; the difference shows as you go. */
export function CountSheetForm({ rows }: { rows: CountSheetRow[] }) {
  const [state, formAction, pending] = useActionState(submitCountAction, IDLE);
  const [sheetKey] = useState(() => crypto.randomUUID());
  const [counts, setCounts] = useState<Record<string, string>>({});
  const entered = Object.values(counts).filter((v) => v.trim() !== "").length;

  if (state.status === "success") {
    return (
      <div className="amb-pop-in space-y-4 rounded-xl border border-emerald-200 bg-emerald-50 p-5" role="status">
        <p className="text-sm font-semibold text-emerald-900">
          Count saved. {state.matched} {state.matched === 1 ? "line" : "lines"} matched the system
          {state.adjusted && state.adjusted.length > 0 ? `, ${state.adjusted.length} corrected.` : "."}
        </p>
        {state.adjusted && state.adjusted.length > 0 && (
          <ul className="space-y-1 text-sm text-emerald-900">
            {state.adjusted.map((a) => (
              <li key={a.name} className="flex justify-between gap-4">
                <span className="truncate">{a.name}</span>
                <span className="tabular-nums font-semibold">{a.delta > 0 ? `+${a.delta}` : a.delta}</span>
              </li>
            ))}
          </ul>
        )}
        <a href="/inventory/stock-take" className={buttonClass("secondary")}>
          Start a new count
        </a>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="sheetKey" value={sheetKey} />
      {state.status === "error" && (
        <p role="alert" className="amb-pop-in rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {state.message}
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[600px] text-sm">
          <caption className="sr-only">Count sheet</caption>
          <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-600">
            <tr>
              <th scope="col" className="px-4 py-3">
                Item
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                System
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                Counted
              </th>
              <th scope="col" className="px-4 py-3 text-right">
                Difference
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const raw = counts[r.variantId] ?? "";
              const counted = raw.trim() === "" ? null : Number(raw);
              const valid = counted !== null && Number.isInteger(counted) && counted >= 0;
              const diff = valid ? counted - (r.recorded ?? 0) : null;
              return (
                <tr key={r.variantId}>
                  <td className="px-4 py-2.5">
                    <input type="hidden" name={`name:${r.variantId}`} value={r.productName} />
                    <span className="font-medium text-slate-900">{r.productName}</span>
                    <span className="block font-mono text-xs text-slate-500">
                      {[r.sku, r.size, r.colour].filter(Boolean).join(" · ")}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">{r.recorded ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right">
                    <label className="sr-only" htmlFor={`count-${r.variantId}`}>
                      Counted {r.productName} {r.sku}
                    </label>
                    <input
                      id={`count-${r.variantId}`}
                      name={`count:${r.variantId}`}
                      inputMode="numeric"
                      value={raw}
                      onChange={(e) =>
                        setCounts((c) => ({ ...c, [r.variantId]: e.target.value.replace(/[^\d]/g, "") }))
                      }
                      className="amb-focus min-h-11 w-24 rounded-lg border border-slate-300 px-3 text-right tabular-nums"
                    />
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right font-semibold tabular-nums ${
                      diff === null
                        ? "text-slate-500"
                        : diff === 0
                          ? "text-emerald-700"
                          : diff > 0
                            ? "text-sky-700"
                            : "text-rose-700"
                    }`}
                  >
                    {diff === null ? "" : diff === 0 ? "Matches" : diff > 0 ? `+${diff}` : diff}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="min-w-[240px] flex-1 text-sm font-medium text-slate-700">
          Note for this count <span className="font-normal text-slate-500">(optional)</span>
          <input
            name="reason"
            maxLength={200}
            placeholder="Monthly count, aisle 3"
            className="amb-focus mt-1 block min-h-11 w-full rounded-lg border border-slate-300 px-3 text-sm placeholder:text-slate-500"
          />
        </label>
        <button
          type="submit"
          disabled={pending || entered === 0}
          aria-busy={pending}
          className={`${buttonClass("primary")} amb-press`}
        >
          {pending ? "Saving…" : `Save ${entered} ${entered === 1 ? "count" : "counts"}`}
        </button>
      </div>
      <p className="text-xs text-slate-500">
        Only lines you fill in are saved. A count that differs from the system corrects the stock and is recorded in the
        movement history.
      </p>
    </form>
  );
}
