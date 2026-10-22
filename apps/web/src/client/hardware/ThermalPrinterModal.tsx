"use client";

import { useState, useRef, useEffect } from "react";
import {
  Printer,
  Usb,
  Bluetooth,
  FileText,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Scissors,
  DollarSign,
  Maximize2,
  ChevronDown,
  X,
  Play,
  RotateCcw,
  Receipt,
  Scale,
} from "lucide-react";
import {
  EscPosBuilder,
  generateEscPosReceipt,
  WebPrinterDriver,
  type PrinterPaperWidth,
  type ReceiptData,
} from "@/client/hardware/escpos";
import { TaxInvoiceA4View } from "@/client/hardware/TaxInvoiceA4View";

export function ThermalPrinterModal(props: {
  isOpen: boolean;
  onClose: () => void;
  receiptData: ReceiptData;
}) {
  const [printMode, setPrintMode] = useState<"thermal" | "tax_invoice">("thermal");
  const [paperWidth, setPaperWidth] = useState<PrinterPaperWidth>("80mm");
  const [kickDrawerOnPrint, setKickDrawerOnPrint] = useState(true);
  const [cutPaper, setCutPaper] = useState(true);
  const [status, setStatus] = useState<"idle" | "printing" | "success" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [activeTab, setActiveTab] = useState<"preview" | "hardware">("preview");

  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (props.isOpen) {
      dialogRef.current?.showModal();
    } else {
      dialogRef.current?.close();
    }
  }, [props.isOpen]);

  if (!props.isOpen) return null;

  // Build raw ESC/POS binary
  const binaryPayload = generateEscPosReceipt(props.receiptData, paperWidth);

  // USB Direct Print
  const handlePrintUsb = async () => {
    setStatus("printing");
    setStatusMessage("Connecting to USB Thermal Printer...");
    const res = await WebPrinterDriver.printViaUsb(binaryPayload);
    if (res.ok) {
      setStatus("success");
      setStatusMessage("Receipt sent to USB thermal printer successfully.");
    } else {
      setStatus("error");
      setStatusMessage(res.error || "USB print failed.");
    }
  };

  // Bluetooth Direct Print
  const handlePrintBluetooth = async () => {
    setStatus("printing");
    setStatusMessage("Searching for paired Bluetooth POS printer...");
    const res = await WebPrinterDriver.printViaBluetooth(binaryPayload);
    if (res.ok) {
      setStatus("success");
      setStatusMessage("Receipt transmitted to Bluetooth printer.");
    } else {
      setStatus("error");
      setStatusMessage(res.error || "Bluetooth print failed.");
    }
  };

  // Standard Browser Print
  const handleSystemPrint = () => {
    props.onClose();
    setTimeout(() => {
      window.print();
    }, 150);
  };

  // Manual Cash Drawer Kick
  const handleKickDrawerOnly = async () => {
    setStatus("printing");
    setStatusMessage("Triggering cash drawer pulse...");
    const p = new EscPosBuilder(paperWidth);
    p.kickDrawer();
    const res = await WebPrinterDriver.printViaUsb(p.build());
    if (res.ok) {
      setStatus("success");
      setStatusMessage("Cash drawer kick pulse sent!");
    } else {
      setStatus("error");
      setStatusMessage(res.error || "Failed to trigger cash drawer.");
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={props.onClose}
      className={`backdrop:bg-slate-900/60 backdrop:backdrop-blur-sm fixed inset-0 z-50 m-auto w-full ${
        printMode === "tax_invoice" ? "max-w-4xl" : "max-w-2xl"
      } max-h-[92vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 shadow-2xl transition-all`}
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 sticky top-0 bg-white/95 backdrop-blur z-20">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600 shadow-sm ring-1 ring-sky-200/50">
            {printMode === "thermal" ? <Printer className="h-5 w-5" /> : <Scale className="h-5 w-5" />}
          </span>
          <div>
            <h2 className="text-base font-bold text-slate-900">
              {printMode === "thermal" ? "Thermal Receipt & Hardware Control" : "Statutory GST Tax Invoice (Rule 46)"}
            </h2>
            <p className="text-xs text-slate-500">
              {printMode === "thermal"
                ? "ESC/POS raw command engine (58mm / 80mm roll, cutter & cash drawer kick)"
                : "Standard A4 / Letter format with HSN tax summary, buyer GSTIN & statutory breakdown"}
            </p>
          </div>
        </div>
        <button
          onClick={props.onClose}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Layout Format Switcher Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-6 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Print Layout:</span>
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
            <button
              type="button"
              onClick={() => setPrintMode("thermal")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                printMode === "thermal"
                  ? "bg-sky-600 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Receipt className="h-3.5 w-3.5" />
              80mm / 58mm Thermal Slip
            </button>
            <button
              type="button"
              onClick={() => setPrintMode("tax_invoice")}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                printMode === "tax_invoice"
                  ? "bg-sky-600 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              Rule 46 A4 Tax Invoice
            </button>
          </div>
        </div>

        {printMode === "thermal" && (
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
            <button
              onClick={() => setActiveTab("preview")}
              className={`flex items-center gap-1.5 border-b-2 py-1 px-1 transition-colors ${
                activeTab === "preview" ? "border-sky-600 text-sky-700 font-bold" : "border-transparent hover:text-slate-900"
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              Preview & Roll Size
            </button>
            <button
              onClick={() => setActiveTab("hardware")}
              className={`ml-3 flex items-center gap-1.5 border-b-2 py-1 px-1 transition-colors ${
                activeTab === "hardware" ? "border-sky-600 text-sky-700 font-bold" : "border-transparent hover:text-slate-900"
              }`}
            >
              <Sliders className="h-3.5 w-3.5" />
              Hardware Direct (USB/BLE)
            </button>
          </div>
        )}
      </div>

      <div className="p-6">
        {printMode === "tax_invoice" ? (
          /* Rule 46 Statutory A4 GST Tax Invoice Preview & Actions */
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs">
              <div className="flex items-center gap-2 text-slate-700">
                <FileText className="h-4 w-4 text-sky-600" />
                <span>Standard A4 Sheet Layout · CGST/SGST/IGST breakdown · HSN Tax grid</span>
              </div>
              <button
                type="button"
                onClick={handleSystemPrint}
                className="amb-press inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-slate-800"
              >
                <Printer className="h-3.5 w-3.5 text-sky-400" />
                Print A4 Tax Invoice (Browser Dialog / PDF)
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-100 p-3 sm:p-5">
              <TaxInvoiceA4View receiptData={props.receiptData} />
            </div>
          </div>
        ) : activeTab === "preview" ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Thermal Print Visualizer */}
            <div className="relative flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-100 p-4">
              <div
                className={`flex flex-col bg-white p-5 font-mono text-[11px] leading-tight text-slate-900 shadow-md ${
                  paperWidth === "58mm" ? "w-[240px]" : "w-[310px]"
                } border-t-4 border-slate-900`}
                style={{ filter: "contrast(1.15)" }}
              >
                {/* Store Header */}
                <div className="text-center font-bold text-base tracking-tight uppercase">
                  {props.receiptData.storeName}
                </div>
                {props.receiptData.storeAddress && (
                  <div className="text-center text-[10px] text-slate-600 mt-0.5">{props.receiptData.storeAddress}</div>
                )}
                {props.receiptData.storePhone && (
                  <div className="text-center text-[10px] text-slate-600">Tel: {props.receiptData.storePhone}</div>
                )}
                {props.receiptData.storeGstin && (
                  <div className="text-center text-[10px] text-slate-600">
                    GSTIN: {props.receiptData.storeGstin}
                  </div>
                )}
                <div className="my-2 border-b border-dashed border-slate-400" />

                {/* Bill Number (Large & Centered) */}
                <div className="text-center font-bold text-lg tracking-wider py-0.5">
                  {props.receiptData.billNumber}
                </div>
                <div className="flex justify-between text-[10px] text-slate-600">
                  <span>
                    {new Date(props.receiptData.date).toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "2-digit",
                    })}{" "}
                    {new Date(props.receiptData.date).toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                    })}
                  </span>
                  <span>{props.receiptData.cashierName ? `Staff: ${props.receiptData.cashierName}` : ""}</span>
                </div>
                {props.receiptData.customerName && (
                  <div className="text-[10px] text-slate-700 mt-1">
                    Customer: {props.receiptData.customerName}
                    {props.receiptData.customerPhone ? ` (${props.receiptData.customerPhone})` : ""}
                  </div>
                )}
                <div className="my-2 border-b border-dashed border-slate-400" />

                {/* Items (Clean 2-line layout) */}
                <div className="space-y-2">
                  {props.receiptData.items.map((it, idx) => (
                    <div key={idx} className="leading-snug">
                      <div className="font-bold text-slate-900">{it.name}</div>
                      <div className="flex justify-between text-slate-700 pl-2">
                        <span>
                          {it.quantity} x {it.variant || Math.round(it.unitPriceMinor / 100)}
                        </span>
                        <span className="font-semibold text-slate-900">
                          {Math.round(it.totalMinor / 100).toLocaleString("en-IN")}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="my-2 border-b border-dashed border-slate-400" />

                {/* Totals */}
                <div className="space-y-1 text-slate-700">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span>{Math.round(props.receiptData.subtotalMinor / 100).toLocaleString("en-IN")}</span>
                  </div>
                  {props.receiptData.discountMinor > 0 && (
                    <div className="flex justify-between text-emerald-700">
                      <span>Discount</span>
                      <span>-{Math.round(props.receiptData.discountMinor / 100).toLocaleString("en-IN")}</span>
                    </div>
                  )}
                </div>

                <div className="my-2 border-b border-dashed border-slate-400" />

                {/* TOTAL */}
                <div className="flex justify-between items-baseline font-bold text-base text-slate-950 py-0.5">
                  <span>TOTAL</span>
                  <span>INR {Math.round(props.receiptData.totalMinor / 100).toLocaleString("en-IN")}</span>
                </div>

                <div className="my-2 border-b border-dashed border-slate-400" />

                {/* Payments */}
                <div className="space-y-1 text-slate-700">
                  {props.receiptData.payments.map((p, i) => (
                    <div key={i} className="flex justify-between">
                      <span>{p.method} Received</span>
                      <span>{Math.round(p.amountMinor / 100).toLocaleString("en-IN")}</span>
                    </div>
                  ))}
                </div>

                <div className="my-2 border-b border-dashed border-slate-400" />

                {/* Footer Message */}
                <div className="my-2 text-center text-[10px] font-semibold text-slate-800">
                  {props.receiptData.footerMessage || "Exchange Within 3 Days / No Return"}
                </div>
              </div>

              <div className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500">
                <Scissors className="h-3.5 w-3.5" />
                <span>Simulated {paperWidth} ESC/POS layout</span>
              </div>
            </div>

            {/* Print Controls */}
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Paper Roll Size
                </label>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaperWidth("80mm")}
                    className={`rounded-xl border p-3 text-left transition-all ${
                      paperWidth === "80mm"
                        ? "border-sky-600 bg-sky-50/50 ring-2 ring-sky-600/20"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="font-bold text-slate-900">80mm Wide</div>
                    <div className="text-[11px] text-slate-500">48 chars (Standard Desktop Thermal)</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaperWidth("58mm")}
                    className={`rounded-xl border p-3 text-left transition-all ${
                      paperWidth === "58mm"
                        ? "border-sky-600 bg-sky-50/50 ring-2 ring-sky-600/20"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="font-bold text-slate-900">58mm Compact</div>
                    <div className="text-[11px] text-slate-500">32 chars (Mobile / Handheld Bluetooth)</div>
                  </button>
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/50 p-3.5">
                <label className="flex items-center gap-2.5 text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={kickDrawerOnPrint}
                    onChange={(e) => setKickDrawerOnPrint(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  <span>Kick Cash Drawer (Pin 2/5 pulse after print)</span>
                </label>

                <label className="flex items-center gap-2.5 text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={cutPaper}
                    onChange={(e) => setCutPaper(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  <span>Auto Partial Cutter (GS V 1)</span>
                </label>
              </div>

              {/* Status Box */}
              {status !== "idle" && (
                <div
                  className={`flex items-start gap-2.5 rounded-xl p-3 text-xs font-medium ${
                    status === "success"
                      ? "bg-emerald-50 text-emerald-800"
                      : status === "error"
                      ? "bg-rose-50 text-rose-800"
                      : "bg-sky-50 text-sky-800"
                  }`}
                >
                  {status === "success" ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  ) : status === "error" ? (
                    <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                  ) : (
                    <RotateCcw className="h-4 w-4 shrink-0 animate-spin text-sky-600" />
                  )}
                  <span>{statusMessage}</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="space-y-2 pt-2">
                <button
                  type="button"
                  onClick={handlePrintUsb}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 py-2.5 px-4 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 active:scale-[0.99]"
                >
                  <Usb className="h-4 w-4 text-sky-400" />
                  Direct USB Print (WebUSB ESC/POS)
                </button>

                <button
                  type="button"
                  onClick={handlePrintBluetooth}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white py-2.5 px-4 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 active:scale-[0.99]"
                >
                  <Bluetooth className="h-4 w-4 text-blue-500" />
                  Bluetooth Print (WebBluetooth)
                </button>

                <button
                  type="button"
                  onClick={handleSystemPrint}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 py-2 text-xs font-medium text-slate-500 hover:border-slate-400 hover:text-slate-700"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Standard Windows/Mac Dialog (F3)
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Hardware Controls Tab */
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2.5 text-slate-900">
                  <DollarSign className="h-5 w-5 text-emerald-600" />
                  <h3 className="text-sm font-bold">Cash Drawer Solenoid</h3>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Triggers an electrical pulse (24V 50ms) to the RJ11/RJ12 drawer port on the printer without printing.
                </p>
                <button
                  type="button"
                  onClick={handleKickDrawerOnly}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700"
                >
                  <Play className="h-3.5 w-3.5" />
                  Kick Cash Drawer Now
                </button>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2.5 text-slate-900">
                  <Scissors className="h-5 w-5 text-indigo-600" />
                  <h3 className="text-sm font-bold">Paper Feed & Cut</h3>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Feeds 4 blank lines and actuates the internal thermal guillotine blade.
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    setStatus("printing");
                    setStatusMessage("Triggering paper cutter...");
                    const p = new EscPosBuilder(paperWidth);
                    p.cut(true);
                    const res = await WebPrinterDriver.printViaUsb(p.build());
                    if (res.ok) {
                      setStatus("success");
                      setStatusMessage("Paper cut completed.");
                    } else {
                      setStatus("error");
                      setStatusMessage(res.error || "Cut command failed.");
                    }
                  }}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  <Scissors className="h-3.5 w-3.5" />
                  Feed & Cut Paper
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-xs text-amber-900">
              <span className="font-bold">Hardware Browser Requirements:</span> Direct USB and Bluetooth thermal printing uses Google Chrome or Microsoft Edge with WebUSB and WebBluetooth enabled. No local printer driver or print-spooler software required.
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
