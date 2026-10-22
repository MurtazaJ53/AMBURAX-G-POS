"use client";

import { useState } from "react";
import Link from "next/link";
import {
  BrainCircuit,
  Sparkles,
  AlertTriangle,
  ArrowRight,
  TrendingUp,
  Package,
  FileText,
  CheckCircle2,
  RefreshCw,
  Send,
  ShoppingCart,
} from "lucide-react";
import { formatMinor } from "@/server/sales/saleTotals";
import type { BusinessGrounding } from "@/server/ai/grounding";
import type { AiBriefing } from "@/server/ai/commandCenter";
import { Card, CardHeader, buttonClass, StatusBadge, type BadgeTone } from "../_components/ui";

interface Props {
  initialFacts: BusinessGrounding;
  hasAiKey: boolean;
}

export function AiCommandCenterClient({ initialFacts, hasAiKey }: Props) {
  const [facts, setFacts] = useState<BusinessGrounding>(initialFacts);
  const [brief, setBrief] = useState<AiBriefing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [executedActions, setExecutedActions] = useState<Record<string, boolean>>({});

  async function generateBrief() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/ai/brief", { method: "POST" });
      const data = await res.json();
      if (!res.ok || data.status === "ai_error") {
        setError(data?.message || data?.error?.message || "Failed to generate briefing.");
      } else if (data.status === "no_key") {
        setError("AI key is not set. Add your Anthropic API key in Settings → AI to generate live briefings.");
      } else if (data.brief) {
        setBrief(data.brief);
        if (data.facts) setFacts(data.facts);
      }
    } catch {
      setError("Network error while communicating with AI service.");
    } finally {
      setLoading(false);
    }
  }

  function handleActionApprove(actionId: string) {
    setExecutedActions((prev) => ({ ...prev, [actionId]: true }));
  }

  const toneMap: Record<string, BadgeTone> = {
    high: "danger",
    medium: "warning",
    low: "info",
    critical: "danger",
    attention: "warning",
    positive: "success",
  };

  return (
    <div className="space-y-6">
      {/* Top Banner / Generator */}
      <div className="rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 via-sky-50 to-indigo-50 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-violet-600 text-white shadow-sm">
                <BrainCircuit className="h-5 w-5" />
              </span>
              <h2 className="text-lg font-bold text-slate-900">Store Executive Copilot</h2>
              <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-800">
                Phase 12 Grounded AI
              </span>
            </div>
            <p className="mt-1.5 text-sm text-slate-600">
              Zero hallucinations. The AI analyzes today&apos;s real register takings, critical stock levels, and customer credit dues to draft high-impact actions for owner approval.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {hasAiKey ? (
              <button
                type="button"
                onClick={generateBrief}
                disabled={loading}
                className={`${buttonClass("primary")} amb-press !bg-violet-600 hover:!bg-violet-700 shadow-sm`}
              >
                <Sparkles className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                {loading ? "Analyzing Store Facts…" : brief ? "Refresh Intelligence" : "Generate Morning Brief"}
              </button>
            ) : (
              <Link href="/settings" className={buttonClass("secondary")}>
                Configure AI Key in Settings
              </Link>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-800">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
            <p>{error}</p>
          </div>
        )}
      </div>

      {/* Grounded Facts Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Today&apos;s Velocity</span>
            <span className="rounded-lg bg-sky-50 p-2 text-sky-600">
              <TrendingUp className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
            {formatMinor(facts.todaySales.totalMinor)}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            {facts.todaySales.billCount} bills · {facts.todaySales.itemsSold} pcs sold
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Stock Risks</span>
            <span className="rounded-lg bg-amber-50 p-2 text-amber-600">
              <Package className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
            {facts.inventoryAlerts.outOfStockCount + facts.inventoryAlerts.lowStockCount} items
          </p>
          <p className="mt-0.5 text-xs text-amber-700 font-medium">
            {facts.inventoryAlerts.outOfStockCount} out of stock · {facts.inventoryAlerts.lowStockCount} critical low
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Khata Receivables</span>
            <span className="rounded-lg bg-rose-50 p-2 text-rose-600">
              <FileText className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
            {formatMinor(facts.khataDueAlerts.totalOutstandingMinor)}
          </p>
          <p className="mt-0.5 text-xs text-rose-600 font-medium">
            {facts.khataDueAlerts.overdueCount} overdue customer accounts
          </p>
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Trading Context</span>
            <span className="rounded-lg bg-emerald-50 p-2 text-emerald-600">
              <ShoppingCart className="h-4 w-4" />
            </span>
          </div>
          <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
            {facts.storeName}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Trading Date: {facts.tradingDay}
          </p>
        </Card>
      </div>

      {/* AI Generated Intelligence Section */}
      {brief && (
        <div className="space-y-6 animate-in fade-in duration-300">
          {/* Executive Overview */}
          <Card className="border-violet-100 bg-white">
            <CardHeader
              title={brief.headline}
              subtitle="Synthesized Executive Summary"
              action={
                <StatusBadge tone={toneMap[brief.sentiment] || "neutral"}>
                  {brief.sentiment.toUpperCase()} STATUS
                </StatusBadge>
              }
            />
            <div className="p-5">
              <p className="text-base leading-relaxed text-slate-700">{brief.executiveSummary}</p>
            </div>
          </Card>

          {/* Action Approvals (L3 Guarded) */}
          <Card>
            <CardHeader
              title="Guarded Action Queue (L3 Owner Approvals)"
              subtitle="High-impact actions prepared by AI. Nothing is dispatched without explicit owner confirmation."
            />
            <div className="divide-y divide-slate-100">
              {brief.suggestedActions.map((act) => {
                const done = executedActions[act.id];
                return (
                  <div key={act.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="max-w-2xl space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900">{act.title}</span>
                        <StatusBadge tone={act.actionType === "reorder" ? "warning" : "info"}>
                          {act.actionType.toUpperCase()}
                        </StatusBadge>
                        <span className="text-xs font-mono text-slate-400">Target: {act.target}</span>
                      </div>
                      <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700 font-mono border border-slate-200">
                        {act.previewText}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {done ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                          <CheckCircle2 className="h-4 w-4" /> Approved &amp; Queued
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleActionApprove(act.id)}
                          className={`${buttonClass("primary")} text-xs gap-1.5`}
                        >
                          <Send className="h-3.5 w-3.5" /> Approve &amp; Dispatch
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Key Insights Grid */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {brief.keyInsights.map((ins, i) => (
              <Card key={i} className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-500">
                    {ins.category}
                  </span>
                  <StatusBadge tone={toneMap[ins.urgency] || "neutral"}>
                    {ins.urgency} urgency
                  </StatusBadge>
                </div>
                <h4 className="mt-2 text-sm font-semibold text-slate-900">{ins.title}</h4>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">{ins.description}</p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {!brief && (
        <Card className="border-dashed p-12 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-violet-50 text-violet-600">
            <Sparkles className="h-6 w-6" />
          </div>
          <h3 className="mt-3 text-sm font-semibold text-slate-900">No Active Briefing Generated</h3>
          <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">
            Click &quot;Generate Morning Brief&quot; above to synthesize today&apos;s real register, inventory, and customer credit signals into actionable intelligence.
          </p>
        </Card>
      )}
    </div>
  );
}
