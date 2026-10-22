"use client";

import { useState, useEffect } from "react";
import { X, UserCog, Check, Search, User } from "lucide-react";

export interface SalesPerson {
  id: string;
  name: string;
  email: string;
  role: string;
}

export function SalesPersonModal(props: {
  isOpen: boolean;
  onClose: () => void;
  selectedStaff: SalesPerson | null;
  onSelect: (staff: SalesPerson | null) => void;
}) {
  const [staffList, setStaffList] = useState<SalesPerson[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.isOpen) return;
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      fetch("/api/v1/staff/active")
        .then((res) => {
          if (!res.ok) throw new Error("Failed to load staff list");
          return res.json();
        })
        .then((data) => {
          if (active) setStaffList(data.staff ?? []);
        })
        .catch((err) => {
          if (active) setError(err.message || "Failed to load staff");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 0);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [props.isOpen]);

  if (!props.isOpen) return null;

  const filtered = staffList.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.email.toLowerCase().includes(search.toLowerCase()) ||
    s.role.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="salesperson-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
    >
      <div className="amb-pop-in relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <UserCog className="h-5 w-5 text-sky-600" />
            <h3 id="salesperson-modal-title" className="text-base font-bold text-slate-900">
              Sales Person Attribution (F7)
            </h3>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-2 text-xs text-slate-500">
          Tag the sales associate responsible for this customer ticket for commission and sales performance attribution.
        </p>

        <div className="mt-3 relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search team member..."
            className="h-9 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
          />
        </div>

        <div className="mt-4 max-h-60 space-y-2 overflow-y-auto pr-1">
          {loading ? (
            <p className="py-6 text-center text-xs text-slate-400">Loading staff members...</p>
          ) : error ? (
            <p className="py-6 text-center text-xs text-rose-600">{error}</p>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No staff members found.</p>
          ) : (
            filtered.map((staff) => {
              const isSelected = props.selectedStaff?.id === staff.id;
              return (
                <button
                  key={staff.id}
                  type="button"
                  onClick={() => {
                    props.onSelect(isSelected ? null : staff);
                    props.onClose();
                  }}
                  className={`flex w-full items-center justify-between rounded-xl border p-2.5 text-left transition-all ${
                    isSelected
                      ? "border-sky-400 bg-sky-50/70 ring-1 ring-sky-500/20"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                      <User className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-900">{staff.name}</p>
                      <p className="text-[10px] text-slate-500">{staff.role.replace("_", " ")} · {staff.email}</p>
                    </div>
                  </div>
                  {isSelected && (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-600 text-white">
                      <Check className="h-3 w-3 stroke-[3]" />
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-3">
          {props.selectedStaff ? (
            <button
              type="button"
              onClick={() => {
                props.onSelect(null);
                props.onClose();
              }}
              className="text-xs font-medium text-rose-600 hover:underline"
            >
              Clear attribution
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white shadow hover:bg-slate-800"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
