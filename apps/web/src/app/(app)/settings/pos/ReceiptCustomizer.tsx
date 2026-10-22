"use client";

import { useState, useEffect } from "react";
import { Printer, Sliders, CheckCircle2 } from "lucide-react";
import { buttonClass } from "../../_components/ui";

export function ReceiptCustomizer(props: { storeName: string; canEdit: boolean }) {
  const [headerText, setHeaderText] = useState(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("pos_receipt_header") || props.storeName;
    }
    return props.storeName;
  });

  const [footerPolicy, setFooterPolicy] = useState(() => {
    if (typeof window !== "undefined") {
      return (
        localStorage.getItem("pos_receipt_footer") ||
        "Items may be exchanged within 7 days with original tag and bill. No cash refunds."
      );
    }
    return "Items may be exchanged within 7 days with original tag and bill. No cash refunds.";
  });

  const [defaultPaper, setDefaultPaper] = useState<"80mm" | "58mm">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("pos_default_paper") as "80mm" | "58mm") || "80mm";
    }
    return "80mm";
  });

  const [enableDigitalQr, setEnableDigitalQr] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("pos_digital_qr") !== "false";
    }
    return true;
  });

  const [saved, setSaved] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (typeof window !== "undefined") {
      localStorage.setItem("pos_receipt_header", headerText);
      localStorage.setItem("pos_receipt_footer", footerPolicy);
      localStorage.setItem("pos_default_paper", defaultPaper);
      localStorage.setItem("pos_digital_qr", enableDigitalQr ? "true" : "false");
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <form onSubmit={handleSave} className="space-y-4">
      {saved && (
        <div className="amb-pop-in flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          Receipt customization and thermal printer defaults saved successfully.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-xs font-medium text-slate-700">Receipt Header Title</label>
          <input
            type="text"
            disabled={!props.canEdit}
            value={headerText}
            onChange={(e) => setHeaderText(e.target.value)}
            className="amb-focus mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 disabled:bg-slate-50"
            placeholder="Store Name or Trading Brand"
          />
          <span className="mt-1 block text-[11px] text-slate-500">
            Prints prominently at the very top of thermal receipts.
          </span>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700">Default Paper Width</label>
          <select
            disabled={!props.canEdit}
            value={defaultPaper}
            onChange={(e) => setDefaultPaper(e.target.value as "80mm" | "58mm")}
            className="amb-focus mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 disabled:bg-slate-50"
          >
            <option value="80mm">80mm Standard (3-inch Desktop Thermal)</option>
            <option value="58mm">58mm Compact (2-inch Mobile / Handheld)</option>
          </select>
          <span className="mt-1 block text-[11px] text-slate-500">
            Pre-selected format for USB/Bluetooth ESC/POS printing.
          </span>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-700">
          Return Policy & Footer Terms
        </label>
        <textarea
          rows={3}
          disabled={!props.canEdit}
          value={footerPolicy}
          onChange={(e) => setFooterPolicy(e.target.value)}
          className="amb-focus mt-1 block w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-900 disabled:bg-slate-50"
          placeholder="Terms and conditions, return duration, warranty details..."
        />
        <span className="mt-1 block text-[11px] text-slate-500">
          Appears above barcode/QR at the bottom of customer receipts.
        </span>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <input
          id="digitalQrToggle"
          type="checkbox"
          disabled={!props.canEdit}
          checked={enableDigitalQr}
          onChange={(e) => setEnableDigitalQr(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
        />
        <label htmlFor="digitalQrToggle" className="text-xs font-medium text-slate-700 cursor-pointer">
          Print Digital e-Bill QR code on receipts for instant smartphone scanning
        </label>
      </div>

      {props.canEdit && (
        <div className="pt-2">
          <button type="submit" className={`${buttonClass("primary")} amb-press cursor-pointer`}>
            Save Receipt Settings
          </button>
        </div>
      )}
    </form>
  );
}
