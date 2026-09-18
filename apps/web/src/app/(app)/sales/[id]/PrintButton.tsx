"use client";

/**
 * Print this bill.
 *
 * `window.print()` and nothing more — a real action with a real result, using the print
 * rules on the bill page. Deliberately the only receipt action offered: e-mail, PDF export
 * and WhatsApp share all appear in the design reference and none of them exist, so shipping
 * those buttons would mean shipping three controls that silently do nothing.
 */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-600 print:hidden"
    >
      Print bill
    </button>
  );
}
