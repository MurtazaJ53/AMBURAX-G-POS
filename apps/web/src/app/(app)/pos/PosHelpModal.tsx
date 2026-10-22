"use client";

import { Keyboard, X } from "lucide-react";

interface ShortcutItem {
  key: string;
  label: string;
  description: string;
}

const SHORTCUTS: ShortcutItem[] = [
  { key: "F1", label: "Help Cheat Sheet", description: "Open this keyboard shortcuts quick reference" },
  { key: "F2", label: "Product Search / Scan", description: "Focus product search input & barcode scanner" },
  { key: "F3", label: "Hold Bill", description: "Temporarily park current cart to serve next customer" },
  { key: "F4", label: "Retrieve Bill", description: "Recall a previously parked or held bill" },
  { key: "F5", label: "New / Select Customer", description: "Open customer picker or register new customer" },
  { key: "F6", label: "Apply Offer / Coupon", description: "Apply promotions, manual discount or coupon code" },
  { key: "F7", label: "Sales Person Attribution", description: "Assign counter staff member for commission tracking" },
  { key: "F8", label: "Complete / Tender Sale", description: "Trigger quick checkout and tender settlement" },
  { key: "F9", label: "Open Cash Drawer", description: "Kick cash register drawer with audio feedback" },
  { key: "Esc", label: "Close / Dismiss", description: "Close open modal or clear search input" },
];

export function PosHelpModal(props: { isOpen: boolean; onClose: () => void }) {
  if (!props.isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pos-help-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
    >
      <div className="amb-pop-in relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
              <Keyboard className="h-4 w-4" />
            </div>
            <div>
              <h3 id="pos-help-title" className="text-base font-bold text-slate-900">
                POS Keyboard Shortcuts
              </h3>
              <p className="text-[11px] text-slate-500">
                High-speed cashier shortcut cheat sheet for rapid checkout.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 max-h-[60vh] divide-y divide-slate-100 overflow-y-auto pr-1">
          {SHORTCUTS.map((item) => (
            <div key={item.key} className="flex items-center justify-between py-2.5">
              <div className="pr-4">
                <span className="text-xs font-semibold text-slate-900">{item.label}</span>
                <p className="text-[11px] text-slate-500">{item.description}</p>
              </div>
              <kbd className="inline-flex min-w-10 items-center justify-center rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1 font-mono text-xs font-bold text-slate-800 shadow-sm">
                {item.key}
              </kbd>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
          <span>Press <strong>Esc</strong> to dismiss this modal anytime</span>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-lg bg-slate-100 px-3.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-200"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
