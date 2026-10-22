import { redirect } from "next/navigation";
import Link from "next/link";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { formatPhone } from "@/lib/customerFields";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import {
  canManageLeads,
  LEAD_LIST_LIMIT,
  LEAD_STAGE_LABEL,
  LEAD_STAGES,
  listLeads,
  type LeadRow,
} from "@/server/b2b/leads";
import { PageHeader, SearchForm } from "../_components/ui";
import { formatDateOnly } from "../sales/formatDateTime";
import { AddLeadButton, LeadCardActions } from "./LeadClient";

/**
 * Leads & pipeline (B2B). Prospective trade buyers grouped by the stage the team has set.
 *
 * Quotations and orders are not built: a quotation needs trade pricing and GST treatment, which
 * are open decisions. "Won" records the outcome only and creates no customer or sale.
 */

const STAGE_TONE: Record<string, string> = {
  NEW: "bg-primary",
  CONTACTED: "bg-violet-600",
  QUALIFIED: "bg-amber-500",
  WON: "bg-emerald-600",
  LOST: "bg-slate-400",
};

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = ((await searchParams).q ?? "").slice(0, 100);

  // Read outside the try so Next always sees this page is per-user.
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("b2b: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  let leads: LeadRow[];
  try {
    leads = await listLeads({ tenantId: ctx.tenantId, query });
  } catch (err) {
    logError("b2b: list failed", err);
    return <ServiceUnavailableScreen />;
  }

  const canManage = canManageLeads(ctx);
  const byStage = new Map(LEAD_STAGES.map((s) => [s, [] as LeadRow[]]));
  for (const l of leads) byStage.get(l.stage)?.push(l);

  return (
    <div className="px-4 py-6 sm:px-6">
      <PageHeader
        title="Leads & pipeline"
        subtitle="Trade buyers you are pursuing. Convert won leads directly into wholesale orders."
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/b2b/orders"
              className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              📦 View Wholesale Orders
            </Link>
            {canManage ? <AddLeadButton /> : null}
          </div>
        }
      />

      <div className="mb-4 max-w-xl">
        <SearchForm action="/b2b" label="Search leads" placeholder="Company, contact, phone or city" defaultValue={query} />
      </div>

      {!canManage && (
        <p className="mb-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          You can view leads. Only an owner or store manager can add or move them.
        </p>
      )}

      {leads.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center">
          <p className="text-sm font-semibold text-slate-900">{query ? `No lead matches "${query}"` : "No leads yet"}</p>
          <p className="mt-1 text-sm text-slate-500">
            {query
              ? "Check the spelling, or search by phone or city."
              : canManage
                ? "Add a trade buyer you are talking to, then move them through the stages."
                : "An owner or store manager can add leads."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {LEAD_STAGES.map((stage) => {
            const rows = byStage.get(stage) ?? [];
            return (
              <section key={stage} aria-labelledby={`stage-${stage}-h`} className="min-w-0 rounded-xl bg-slate-50 p-3">
                <h2 id={`stage-${stage}-h`} className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <span aria-hidden="true" className={`size-2 rounded-full ${STAGE_TONE[stage]}`} />
                  {LEAD_STAGE_LABEL[stage]}
                  <span className="ml-auto tabular-nums text-slate-500">{rows.length}</span>
                </h2>
                {rows.length === 0 ? (
                  <p className="px-1 py-3 text-xs text-slate-500">None</p>
                ) : (
                  <ul className="space-y-2">
                    {rows.map((l) => (
                      <li key={l.id} className="amb-fade-in rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                        <p className="truncate text-sm font-semibold text-slate-900" title={l.company}>
                          {l.company}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-slate-600">
                          {[l.contactName, l.phone ? formatPhone(l.phone) : null, l.city].filter(Boolean).join(" · ") ||
                            "No contact details"}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {l.source ? `${l.source} · ` : ""}Updated {formatDateOnly(l.updatedAt)}
                        </p>
                        {canManage && <LeadCardActions lead={l} />}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
      {leads.length === LEAD_LIST_LIMIT && (
        <p className="mt-3 text-sm text-slate-500">
          Showing the {LEAD_LIST_LIMIT} most recently updated. Search to narrow.
        </p>
      )}
    </div>
  );
}
