"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import { CustomerStatementModal, type StatementInvoice } from "./CustomerStatementModal";

export function CustomerStatementButton(props: {
  customer: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    customerType?: string;
  };
  khataData?: {
    totalDueMinor: number;
    overdueMinor: number;
    invoices: StatementInvoice[];
  } | null;
  storeName?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="amb-press inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-800 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
      >
        <FileText aria-hidden="true" className="h-4 w-4 text-slate-500" />
        Statement
      </button>

      <CustomerStatementModal
        isOpen={open}
        onClose={() => setOpen(false)}
        customer={props.customer}
        khataData={props.khataData}
        storeName={props.storeName}
      />
    </>
  );
}
