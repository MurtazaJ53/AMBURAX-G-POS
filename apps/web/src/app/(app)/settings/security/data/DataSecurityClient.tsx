"use client";

import { useState, useTransition } from "react";
import {
  flushOutboxAction,
  exportTenantDataAction,
} from "./actions";
import {
  Database,
  Download,
  RefreshCw,
  CheckCircle,
  HardDrive,
  Lock,
  Layers,
  FileJson,
  ShieldCheck,
} from "lucide-react";
import type { DataSecurityMetrics } from "@/server/identity/dataSecurityService";

export function DataSecurityClient({ metrics }: { metrics: DataSecurityMetrics }) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleExport = () => {
    startTransition(async () => {
      setFeedback(null);
      const res = await exportTenantDataAction();
      if (res.status === "success" && res.downloadData) {
        // Trigger client download of the JSON file
        const blob = new Blob([res.downloadData], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `amburax-tenant-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setFeedback({ type: "success", text: res.message || "Data exported." });
      } else {
        setFeedback({ type: "error", text: res.message || "Export failed." });
      }
    });
  };

  const handleFlushOutbox = () => {
    startTransition(async () => {
      setFeedback(null);
      const res = await flushOutboxAction();
      if (res.status === "success") {
        setFeedback({ type: "success", text: res.message || "Outbox synchronized." });
      } else {
        setFeedback({ type: "error", text: res.message || "Failed to flush outbox." });
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Toast Feedback */}
      {feedback && (
        <div
          className={`flex items-center gap-2 rounded-xl p-4 text-xs font-semibold border ${
            feedback.type === "success"
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-rose-50 text-rose-800 border-rose-200"
          }`}
        >
          <CheckCircle className="h-4 w-4 shrink-0" />
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Database & Storage Status Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">AMBURAX core</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Connected
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900">AMBURAX database</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Local ACID-isolated database cluster</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Outbox Queue</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 border border-blue-200">
              {metrics.outboxSummary.pending} Pending
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900">{metrics.outboxSummary.published}</span>
            <span className="text-xs text-slate-500 font-medium">delivered events</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            {metrics.outboxSummary.deadLettered > 0
              ? `${metrics.outboxSummary.deadLettered} dead-lettered events`
              : "Zero failed dispatches"}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Audit Ledger</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-700 border border-indigo-200">
              Immutable
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900">{metrics.auditLogsCount}</span>
            <span className="text-xs text-slate-500 font-medium">security logs</span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Every staff and policy action audited</p>
        </div>
      </div>

      {/* Interactive Storage & Backup Controls */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
          <div className="rounded-lg bg-emerald-50 p-2 text-emerald-600">
            <HardDrive className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">Tenant Data Backup & Snapshots</h2>
            <p className="text-xs text-slate-500">
              Export encrypted tenant catalog, orders, and ledger or trigger background sync.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/50 p-5">
            <div>
              <div className="flex items-center gap-2">
                <FileJson className="h-5 w-5 text-blue-600" />
                <h3 className="font-bold text-slate-900 text-sm">Download Tenant Snapshot</h3>
              </div>
              <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                Generate and download a complete, portable JSON archive of all catalog products, store ledgers, customer accounts, and recorded sales.
              </p>
            </div>
            <button
              type="button"
              disabled={isPending}
              onClick={handleExport}
              className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-slate-800 disabled:opacity-50 transition"
            >
              <Download className="h-4 w-4" />
              {isPending ? "Generating Snapshot..." : "Download Data Snapshot"}
            </button>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-slate-200 bg-slate-50/50 p-5">
            <div>
              <div className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5 text-emerald-600" />
                <h3 className="font-bold text-slate-900 text-sm">Force Outbox Re-Sync</h3>
              </div>
              <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                Immediately trigger dispatcher retry on any dead-lettered or stalled outbox events without waiting for scheduled exponential backoff.
              </p>
            </div>
            <button
              type="button"
              disabled={isPending}
              onClick={handleFlushOutbox}
              className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 disabled:opacity-50 transition"
            >
              <RefreshCw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
              {isPending ? "Syncing..." : "Sync Pending Events"}
            </button>
          </div>
        </div>
      </div>

      {/* Security Architecture Guarantees */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="font-bold text-slate-900 text-sm mb-4">Security Architecture Guarantees</h3>
        <div className="grid gap-3 sm:grid-cols-3 text-xs">
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-3.5">
            <span className="font-semibold text-slate-900 flex items-center gap-1.5">
              <Lock className="h-3.5 w-3.5 text-blue-600" /> Zero Plaintext Storage
            </span>
            <p className="mt-1 text-slate-500">
              All credentials, PINs, and session tokens are hashed via Argon2id &amp; Bcrypt prior to persistence.
            </p>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50 p-3.5">
            <span className="font-semibold text-slate-900 flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Tenant Row-Level Isolation
            </span>
            <p className="mt-1 text-slate-500">
              Foreign keys strictly scope every customer, invoice, and product to your unique organization ID.
            </p>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50 p-3.5">
            <span className="font-semibold text-slate-900 flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-indigo-600" /> Transactional Outbox
            </span>
            <p className="mt-1 text-slate-500">
              At-least-once delivery guarantees prevent financial discrepancies between the POS counter and the accounting ledgers.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
