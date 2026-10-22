"use client";

import { useActionState, useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Boxes, Check, KeyRound, Search, Store, Users, Warehouse } from "lucide-react";
import type { AvailableStore } from "@/server/tenant/storeSelection";
import { selectStoreAction, type SelectStoreState } from "./actions";

const IDLE: SelectStoreState = { status: "idle" };

const ROLE_LABEL: Record<string, string> = {
  OWNER: "Owner",
  STORE_MANAGER: "Store Manager",
  SALES_ASSOCIATE: "Sales Associate",
  CASHIER: "Cashier",
  INVENTORY_MANAGER: "Inventory Manager",
  ACCOUNTANT: "Accountant",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase();
}

/** Pull the invitation token out of a pasted invite link, or accept the bare token. */
function inviteTokenFrom(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const fromUrl = /\/invite\/([A-Za-z0-9_-]{16,})/.exec(value);
  if (fromUrl) return fromUrl[1]!;
  return /^[A-Za-z0-9_-]{16,}$/.test(value) ? value : null;
}

export function SelectStoreForm({
  stores,
  currentStoreId,
}: {
  stores: AvailableStore[];
  currentStoreId: string | null;
}) {
  const [state, formAction, pending] = useActionState(selectStoreAction, IDLE);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string>(currentStoreId ?? stores[0]?.id ?? "");
  const [joinOpen, setJoinOpen] = useState(false);
  const [invite, setInvite] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const router = useRouter();
  const searchId = useId();

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return stores;
    return stores.filter((s) => [s.name, s.code, s.city, s.state].some((v) => v.toLowerCase().includes(q)));
  }, [stores, query]);

  function openInvite() {
    const token = inviteTokenFrom(invite);
    if (!token) {
      setInviteError("Paste the full invitation link from your email.");
      return;
    }
    router.push(`/invite/${token}`);
  }

  return (
    <form action={formAction} className="space-y-4">
      {state.status === "error" && (
        <p role="alert" className="amb-pop-in rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {state.message}
        </p>
      )}

      {stores.length > 3 && (
        <div className="relative">
          <label htmlFor={searchId} className="sr-only">
            Search stores
          </label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
          />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search stores by name, code or location…"
            className="amb-focus min-h-11 w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm text-slate-800 placeholder:text-slate-500 transition-colors focus:border-blue-500"
          />
        </div>
      )}

      <fieldset>
        <legend className="sr-only">Stores you can work in</legend>
        {visible.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-600">
            No store matches “{query}”.
          </p>
        ) : (
          <ul className="space-y-3">
            {visible.map((s, i) => {
              const checked = selected === s.id;
              const Icon = s.storeType === "WAREHOUSE" ? Warehouse : Store;
              return (
                <li key={s.id} className="amb-fade-in" style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}>
                  <label
                    className={`amb-lift flex cursor-pointer items-center gap-4 rounded-xl border bg-white p-4 transition-colors ${
                      checked ? "border-blue-500 bg-blue-50/40 ring-1 ring-blue-500" : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="storeId"
                      value={s.id}
                      checked={checked}
                      onChange={() => setSelected(s.id)}
                      className="peer sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500 peer-focus-visible:ring-offset-2 ${
                        checked ? "border-blue-600 bg-primary" : "border-slate-300 bg-white"
                      }`}
                    >
                      {checked && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                    </span>
                    <span
                      aria-hidden="true"
                      className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-base font-bold text-blue-700"
                    >
                      {initials(s.name) || <Icon className="h-6 w-6" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-base font-semibold text-slate-900">{s.name}</span>
                        {s.isDefault && (
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                            Default
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-sm text-slate-600">
                        {s.code} · {s.city}, {s.state}
                      </span>
                      <span className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                        <Icon aria-hidden="true" className="h-3.5 w-3.5" />
                        {s.storeType === "WAREHOUSE" ? "Warehouse" : "Retail store"}
                      </span>
                    </span>
                    <span className="hidden shrink-0 space-y-1 text-sm text-slate-600 sm:block">
                      <span className="flex items-center gap-2">
                        <Users aria-hidden="true" className="h-4 w-4 text-slate-500" />
                        {s.staffCount} {s.staffCount === 1 ? "person" : "people"}
                      </span>
                      <span className="flex items-center gap-2">
                        <Boxes aria-hidden="true" className="h-4 w-4 text-slate-500" />
                        {s.itemsInStock} in stock
                      </span>
                      <span className="flex items-center gap-2 font-medium text-emerald-700">
                        <KeyRound aria-hidden="true" className="h-4 w-4" />
                        {s.role ? (ROLE_LABEL[s.role] ?? s.role) : "Owner access"}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>

      <div className="rounded-xl border border-dashed border-slate-300 bg-white">
        {!joinOpen ? (
          <button
            type="button"
            onClick={() => setJoinOpen(true)}
            className="amb-focus flex min-h-11 w-full items-center gap-4 rounded-xl px-4 py-3 text-left transition-colors hover:bg-slate-50"
          >
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-xl text-blue-600"
            >
              +
            </span>
            <span>
              <span className="block text-sm font-semibold text-slate-900">Join another store</span>
              <span className="block text-sm text-slate-600">Have an invitation? Paste its link to join.</span>
            </span>
          </button>
        ) : (
          <div className="amb-pop-in space-y-2 p-4">
            <label htmlFor="invite-link" className="block text-sm font-semibold text-slate-900">
              Invitation link
            </label>
            <div className="flex gap-2">
              <input
                id="invite-link"
                value={invite}
                onChange={(e) => {
                  setInvite(e.target.value);
                  setInviteError(null);
                }}
                placeholder="https://…/invite/…"
                aria-invalid={inviteError ? true : undefined}
                aria-describedby={inviteError ? "invite-error" : undefined}
                className="amb-focus min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm placeholder:text-slate-500"
              />
              <button
                type="button"
                onClick={openInvite}
                className="amb-focus amb-press min-h-11 rounded-xl border border-blue-600 px-4 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-50"
              >
                Open
              </button>
            </div>
            {inviteError && (
              <p id="invite-error" role="alert" className="text-sm text-red-700">
                {inviteError}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={pending || !selected}
          aria-busy={pending}
          className="amb-focus amb-press inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-primary px-8 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Opening…" : "Continue"}
          {!pending && <ArrowRight aria-hidden="true" className="h-4 w-4" />}
        </button>
      </div>
    </form>
  );
}
