"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, X, Search, Filter, ChevronLeft, ChevronRight, ChevronDown, MoreHorizontal, Send, Download, FileText } from "lucide-react";
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
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className={buttonClass("secondary")}
        disabled
        aria-disabled="true"
        title="Reminders are managed in ERPNext (Not connected)"
      >
        <Send className="mr-2 h-4 w-4 inline opacity-50" />
        Send Reminder
      </button>
      <button
        type="button"
        className={buttonClass("primary")}
        onClick={() => setOpen(true)}
      >
        <Plus className="mr-2 h-4 w-4 inline" />
        Add Customer
      </button>
      <button
        type="button"
        className={buttonClass("secondary")}
        disabled
        aria-disabled="true"
        title="Export is not currently available"
      >
        <Download className="mr-2 h-4 w-4 inline opacity-50" />
        Export
      </button>
      <button
        type="button"
        className={buttonClass("secondary")}
        disabled
        aria-disabled="true"
        title="Khata ledgers are managed in ERPNext (Not connected)"
      >
        <FileText className="mr-2 h-4 w-4 inline opacity-50" />
        New Khata
      </button>
      <CustomerCreateDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

export function CustomerToolbar({ initialQuery, initialType }: { initialQuery: string; initialType: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery(searchParams.get("q") ?? "");
  }, [searchParams]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams(searchParams as any);
    if (query.trim()) {
      params.set("q", query.trim());
    } else {
      params.delete("q");
    }
    params.delete("page");
    router.push(`/customers?${params.toString()}`);
  }

  function handleTypeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams as any);
    if (e.target.value) {
      params.set("customerType", e.target.value);
    } else {
      params.delete("customerType");
    }
    params.delete("page");
    router.push(`/customers?${params.toString()}`);
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-slate-100 p-4 bg-white rounded-t-xl">
      <div className="flex items-center w-full sm:w-auto">
        <h2 className="text-base font-bold text-slate-900 hidden sm:block mr-6">Customers</h2>
      </div>

      <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 w-full sm:w-auto justify-end">
        <div className="relative">
          <label htmlFor="segment-filter" className="sr-only">Filter by Segment</label>
          <select
            id="segment-filter"
            value={initialType}
            onChange={handleTypeChange}
            className="h-9 appearance-none rounded-full border border-slate-200 bg-white pl-4 pr-9 text-xs font-medium text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 hover:bg-slate-50 transition-colors"
          >
            <option value="">All Segments</option>
            <option value="RETAIL">Retail</option>
            <option value="WHOLESALE">Wholesale</option>
            <option value="DISTRIBUTOR">Distributor</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        </div>

        <div className="relative">
          <label htmlFor="group-filter" className="sr-only">Filter by Group</label>
          <select
            id="group-filter"
            disabled
            title="Customer groups are not configured"
            className="h-9 appearance-none rounded-full border border-slate-200 bg-slate-50 pl-4 pr-9 text-xs font-medium text-slate-400 cursor-not-allowed opacity-70"
          >
            <option value="">All Groups</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-300" />
        </div>

        <form onSubmit={handleSearch} className="relative flex-1 sm:w-56">
          <label htmlFor="search-customers" className="sr-only">Search customers</label>
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            id="search-customers"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search customer..."
            className="h-9 w-full rounded-full border border-slate-200 pl-9 pr-3 text-xs placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 hover:bg-slate-50 transition-colors"
          />
        </form>
        
        <button
          type="button"
          disabled
          aria-disabled="true"
          title="Advanced filters not available"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 opacity-70 cursor-not-allowed"
        >
          <Filter className="h-3.5 w-3.5" />
          <span className="sr-only">Filter options</span>
        </button>
      </div>
    </div>
  );
}
