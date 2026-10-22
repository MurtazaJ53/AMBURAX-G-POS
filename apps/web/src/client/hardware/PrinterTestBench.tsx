"use client";

import { useState } from "react";
import { Printer, Usb, Bluetooth, DollarSign, Scissors, CheckCircle2, AlertCircle, Play, RotateCcw } from "lucide-react";
import { EscPosBuilder, WebPrinterDriver } from "@/client/hardware/escpos";

export function PrinterTestBench() {
  const [paperWidth, setPaperWidth] = useState<"58mm" | "80mm">("80mm");
  const [status, setStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");

  const handleTestPrint = async (type: "usb" | "bluetooth") => {
    setStatus("testing");
    setStatusMessage(type === "usb" ? "Opening WebUSB printer channel..." : "Connecting via WebBluetooth...");

    const p = new EscPosBuilder(paperWidth);
    p.align("center")
      .bold(true)
      .size(2, 2)
      .line("AMBURAX POS")
      .size(1, 1)
      .bold(false)
      .line("HARDWARE TEST TICKET")
      .divider("=")
      .align("left")
      .line(`Date: ${new Date().toLocaleDateString("en-IN")}`)
      .line(`Time: ${new Date().toLocaleTimeString("en-IN")}`)
      .line(`Format: ESC/POS Thermal ${paperWidth}`)
      .divider("-")
      .columns("Printhead Test", "[PASSED]")
      .columns("Line Feed Feed", "[PASSED]")
      .columns("Buzzer / Status", "[OK]")
      .divider("=")
      .align("center")
      .line("HARDWARE WORKING PROPERLY")
      .feed(2)
      .cut(true)
      .kickDrawer();

    const payload = p.build();
    const res = type === "usb" ? await WebPrinterDriver.printViaUsb(payload) : await WebPrinterDriver.printViaBluetooth(payload);

    if (res.ok) {
      setStatus("success");
      setStatusMessage("Test receipt printed & cash drawer kicked!");
    } else {
      setStatus("error");
      setStatusMessage(res.error || "Device communication failed.");
    }
  };

  const handleDrawerPulseOnly = async () => {
    setStatus("testing");
    setStatusMessage("Sending 24V solenoid pulse to cash drawer...");
    const p = new EscPosBuilder(paperWidth);
    p.kickDrawer();
    const res = await WebPrinterDriver.printViaUsb(p.build());
    if (res.ok) {
      setStatus("success");
      setStatusMessage("Cash drawer kick pulse sent!");
    } else {
      setStatus("error");
      setStatusMessage(res.error || "Kick failed.");
    }
  };

  return (
    <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 text-white shadow-md shadow-sky-500/20">
            <Printer className="h-6 w-6" />
          </span>
          <div>
            <h3 className="text-base font-bold text-slate-900">Thermal Printer & Hardware Diagnostics</h3>
            <p className="text-xs text-slate-500">Test USB/Bluetooth ESC/POS printers, cutter blades, and 24V cash drawer solenoids</p>
          </div>
        </div>

        {/* Paper Size selector */}
        <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-1 text-xs font-semibold text-slate-600">
          <button
            type="button"
            onClick={() => setPaperWidth("80mm")}
            className={`rounded-md px-3 py-1.5 transition-all ${
              paperWidth === "80mm" ? "bg-white text-slate-900 shadow-sm" : "hover:text-slate-900"
            }`}
          >
            80mm Standard
          </button>
          <button
            type="button"
            onClick={() => setPaperWidth("58mm")}
            className={`rounded-md px-3 py-1.5 transition-all ${
              paperWidth === "58mm" ? "bg-white text-slate-900 shadow-sm" : "hover:text-slate-900"
            }`}
          >
            58mm Compact
          </button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3 [&>*]:min-w-0">
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
          <div className="flex items-center gap-2 font-semibold text-slate-800 text-xs">
            <Usb className="h-4 w-4 text-sky-600" /> Direct USB ESC/POS
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Plug any Epson, TVS, Citizen, or generic POS-80/POS-58 printer via USB cable.
          </p>
          <button
            type="button"
            onClick={() => handleTestPrint("usb")}
            className="mt-3.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary py-2 text-xs font-semibold text-white shadow-sm hover:bg-primary-hover cursor-pointer"
          >
            <Play className="h-3.5 w-3.5 text-white" /> Test USB Print
          </button>
        </div>

        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
          <div className="flex items-center gap-2 font-semibold text-slate-800 text-xs">
            <Bluetooth className="h-4 w-4 text-primary" /> Bluetooth Wireless
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Connect wireless battery-powered or tabletop thermal receipt printers.
          </p>
          <button
            type="button"
            onClick={() => handleTestPrint("bluetooth")}
            className="mt-3.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 cursor-pointer"
          >
            <Play className="h-3.5 w-3.5 text-primary" /> Test Bluetooth Print
          </button>
        </div>

        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
          <div className="flex items-center gap-2 font-semibold text-slate-800 text-xs">
            <DollarSign className="h-4 w-4 text-emerald-600" /> Cash Drawer Kick
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Send Pin 2/5 pulse through printer&apos;s RJ11 port to open the cash drawer instantly.
          </p>
          <button
            type="button"
            onClick={handleDrawerPulseOnly}
            className="mt-3.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700"
          >
            <DollarSign className="h-3.5 w-3.5" /> Kick Drawer
          </button>
        </div>
      </div>

      {status !== "idle" && (
        <div
          className={`mt-4 flex items-center gap-2.5 rounded-xl p-3 text-xs font-medium ${
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
    </div>
  );
}
