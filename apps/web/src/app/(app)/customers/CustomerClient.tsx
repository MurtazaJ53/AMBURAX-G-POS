"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, X, Search, Filter, ChevronLeft, ChevronRight, ChevronDown, MoreHorizontal } from "lucide-react";
import { createCustomerAction } from "./actions";

// Assume standard UI components exist in amubrax codebase, actually AMBURAX UI components are in `../_components/ui.tsx`
import { Card, PageHeader, EmptyState, DataTable, Th, Td, buttonClass, StatusBadge } from "../_components/ui";

export function CustomerCreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [state, action, isPending] = useActionState(createCustomerAction, { status: "idle" });

  useEffect(() => {
    if (state.status === "success") {
      onClose();
    }
  }, [state.status, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">Add Customer</h2>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <form action={action} className="space-y-4">
          {state.status === "error" && !state.field && (
            <div className="rounded bg-red-50 p-3 text-sm text-red-600">{state.message}</div>
          )}
          <div>
            <label htmlFor="name" className="mb-1 block text-sm font-medium">Customer Name <span className="text-red-500">*</span></label>
            <input
              id="name"
              name="name"
              type="text"
              required
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            {state.status === "error" && state.field === "name" && (
              <p className="mt-1 text-xs text-red-600">{state.message}</p>
            )}
          </div>
          <div>
            <label htmlFor="phone" className="mb-1 block text-sm font-medium">Phone Number</label>
            <input
              id="phone"
              name="phone"
              type="tel"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <p className="mt-1 text-xs text-slate-500">Used to uniquely identify the customer at the till.</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className={buttonClass("secondary")}>Cancel</button>
            <button type="submit" disabled={isPending} className={buttonClass("primary")}>
              {isPending ? "Adding..." : "Add Customer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function CustomerActions() {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        className={buttonClass("secondary")}
        disabled
        title="ERP connection unavailable"
      >
        Send Reminder
      </button>
      <button
        type="button"
        className={buttonClass("primary")}
        onClick={() => setOpen(true)}
      >
        <Plus className="mr-2 h-4 w-4 inline" /> Add Customer
      </button>
      <button
        type="button"
        className={buttonClass("secondary")}
        disabled
        title="ERP connection unavailable"
      >
        New Khata
      </button>
      <CustomerCreateDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
