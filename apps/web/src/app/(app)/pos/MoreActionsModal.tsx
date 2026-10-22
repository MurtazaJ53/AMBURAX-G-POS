"use client";

import { useEffect, useState } from "react";
import {
  X,
  ArrowDownRight,
  History,
  Printer,
  ShieldCheck,
  ExternalLink,
  Calculator,
  UserCheck,
  UserX,
  Clock,
  Loader2,
  AlertCircle,
  CalendarOff,
  Vault,
} from "lucide-react";
import Link from "next/link";
import { apiRequest } from "@/client/platform/apiClient";
import { playPosBeep } from "@/client/pos/posSound";

interface AttendanceStatus {
  clockedIn: boolean;
  lastPunchAt: string | null;
  userName?: string;
  storeName?: string;
}

export function MoreActionsModal(props: {
  isOpen: boolean;
  onClose: () => void;
  onReprintLast?: () => void;
}) {
  const [attendance, setAttendance] = useState<AttendanceStatus | null>(null);
  const [punching, setPunching] = useState(false);
  const [punchMsg, setPunchMsg] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    if (!props.isOpen) return;
    let active = true;

    async function loadStatus() {
      try {
        const res = await apiRequest<AttendanceStatus>("/api/v1/staff/attendance/punch");
        if (active && res.ok) {
          setAttendance(res.data);
        }
      } catch {
        // silent fail on status lookup
      }
    }

    loadStatus();
    return () => {
      active = false;
    };
  }, [props.isOpen]);

  if (!props.isOpen) return null;

  async function handlePunchToggle() {
    if (!attendance) return;
    setPunching(true);
    setPunchMsg(null);
    const nextLogType = attendance.clockedIn ? "OUT" : "IN";

    try {
      const res = await apiRequest<{ ok: boolean; clockedIn: boolean; message: string }>(
        "/api/v1/staff/attendance/punch",
        {
          method: "POST",
          body: JSON.stringify({ logType: nextLogType }),
        }
      );
      if (res.ok) {
        setAttendance((prev) =>
          prev
            ? {
                ...prev,
                clockedIn: res.data.clockedIn,
                lastPunchAt: new Date().toISOString(),
              }
            : null
        );
        setPunchMsg({ text: res.data.message });
      } else {
        const errorText = res.kind === "api" ? res.message : "Network error recording punch.";
        setPunchMsg({ text: errorText, error: true });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to record punch.";
      setPunchMsg({ text: msg, error: true });
    } finally {
      setPunching(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="more-actions-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
    >
      <div className="amb-pop-in relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Calculator className="h-5 w-5 text-sky-600" />
            <h3 id="more-actions-title" className="text-base font-bold text-slate-900">
              Till &amp; Counter Operations
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

        {/* Quick Cashier Attendance Punch Bar */}
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                  attendance?.clockedIn ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                }`}
              >
                {attendance?.clockedIn ? <UserCheck className="h-4 w-4" /> : <UserX className="h-4 w-4" />}
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-slate-900">
                    {attendance ? (attendance.clockedIn ? "Clocked In" : "Clocked Out") : "Staff Attendance"}
                  </span>
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      attendance?.clockedIn ? "bg-emerald-500 animate-pulse" : "bg-amber-400"
                    }`}
                  />
                </div>
                <p className="text-[10px] text-slate-500">
                  {attendance?.lastPunchAt
                    ? `Last punch: ${new Date(attendance.lastPunchAt).toLocaleTimeString("en-IN", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}`
                    : "No punches today yet"}
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={punching}
              onClick={handlePunchToggle}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition-all ${
                attendance?.clockedIn
                  ? "border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                  : "border border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
              }`}
            >
              {punching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Clock className="h-3.5 w-3.5" />
              )}
              <span>{attendance?.clockedIn ? "Clock Out" : "Clock In"}</span>
            </button>
          </div>

          {punchMsg && (
            <div
              className={`mt-2 flex items-center gap-1.5 rounded-md p-1.5 text-[11px] ${
                punchMsg.error ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"
              }`}
            >
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{punchMsg.text}</span>
            </div>
          )}
        </div>

        <p className="mt-3 text-xs text-slate-500">
          Quick shortcuts for register cash management, shift closure, and receipt operations.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Link
            href="/staff/shifts"
            onClick={props.onClose}
            className="flex flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 p-4 text-center transition-all hover:border-sky-300 hover:bg-sky-50/50"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <ArrowDownRight className="h-5 w-5" />
            </div>
            <div>
              <span className="text-xs font-bold text-slate-900">Cash Pay In / Out</span>
              <p className="mt-0.5 text-[10px] text-slate-500">Log cash drawer in/out</p>
            </div>
          </Link>

          <Link
            href="/staff/shifts"
            onClick={props.onClose}
            className="flex flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 p-4 text-center transition-all hover:border-sky-300 hover:bg-sky-50/50"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <span className="text-xs font-bold text-slate-900">Till Day Close</span>
              <p className="mt-0.5 text-[10px] text-slate-500">Count &amp; reconcile drawer</p>
            </div>
          </Link>

          <Link
            href="/sales"
            onClick={props.onClose}
            className="flex flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 p-4 text-center transition-all hover:border-sky-300 hover:bg-sky-50/50"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-50 text-sky-600">
              <History className="h-5 w-5" />
            </div>
            <div>
              <span className="text-xs font-bold text-slate-900">Recent Bills</span>
              <p className="mt-0.5 text-[10px] text-slate-500">Search &amp; lookup past sales</p>
            </div>
          </Link>

          {props.onReprintLast ? (
            <button
              type="button"
              onClick={() => {
                props.onReprintLast?.();
                props.onClose();
              }}
              className="flex flex-col items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50/40 p-4 text-center transition-all hover:border-amber-400 hover:bg-amber-100/50"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                <Printer className="h-5 w-5" />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-900">Re-print Last Bill</span>
                <p className="mt-0.5 text-[10px] text-amber-800">Quick receipt reprint</p>
              </div>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                window.print();
                props.onClose();
              }}
              className="flex flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 p-4 text-center transition-all hover:border-sky-300 hover:bg-sky-50/50"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                <Printer className="h-5 w-5" />
              </div>
              <div>
                <span className="text-xs font-bold text-slate-900">Print Screen / Slip</span>
                <p className="mt-0.5 text-[10px] text-slate-500">Send to thermal printer</p>
              </div>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              playPosBeep("drawer");
              props.onClose();
            }}
            className="col-span-2 flex items-center justify-center gap-3 rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-center transition-all hover:border-sky-300 hover:bg-sky-50/50"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
              <Vault className="h-4 w-4" />
            </div>
            <div className="text-left">
              <span className="text-xs font-bold text-slate-900">Open Cash Drawer</span>
              <span className="ml-1.5 rounded bg-slate-200 px-1 py-0.5 font-mono text-[9px] font-bold text-slate-700">F9</span>
              <p className="text-[10px] text-slate-500">Send pulse signal to cash drawer solenoid</p>
            </div>
          </button>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
          <Link
            href="/staff/leave"
            onClick={props.onClose}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-sky-700"
          >
            <CalendarOff className="h-3.5 w-3.5 text-slate-400" />
            <span>Apply Leave</span>
          </Link>
          <Link
            href="/dashboard"
            onClick={props.onClose}
            className="flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-sky-700"
          >
            <span>Dashboard</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
