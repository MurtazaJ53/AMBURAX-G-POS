import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { Building2, ExternalLink } from "lucide-react";
import { db } from "@/server/db";
import { getErpCompany } from "@/server/ops/operations";
import { ConnectErp } from "./ConnectErp";
import { GstRegistration } from "./GstRegistration";
import { Card, CardHeader, PageHeader, PermissionDeniedState, StatusBadge } from "../../_components/ui";

/**
 * Company / business settings (screen 72). ERPNext's Company is the master (standing rule), so this
 * screen reads it live and shows how AMBURAX's business record and stores line up with it. The legal
 * company is changed in ERPNext.
 */
export default async function CompanyPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("company: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  if (ctx.tenantRole !== "OWNER") {
    return (
      <div className="px-4 py-6 sm:px-6">
        <PageHeader title="Company" breadcrumb={[{ label: "Settings", href: "/settings" }]} />
        <PermissionDeniedState title="Company details are for the owner" description="They hold the business's legal and tax identity." />
      </div>
    );
  }
  let tenant, companies, erp;
  try {
    [tenant, companies, erp] = await Promise.all([
      db.tenant.findUniqueOrThrow({
        where: { id: ctx.tenantId },
        select: { name: true, country: true, taxId: true, contactEmail: true, contactPhone: true, erpnextProvisionStatus: true, erpnextProvisionError: true },
      }),
      db.company.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { name: "asc" },
        select: { id: true, name: true, code: true, currency: true, stores: { select: { id: true, name: true, code: true, state: true }, orderBy: { name: "asc" } } },
      }),
      getErpCompany(ctx.tenantId),
    ]);
  } catch (err) {
    logError("company: load failed", err);
    return <ServiceUnavailableScreen />;
  }
  const row = (k: string, v: string | null | undefined) => (
    <div key={k}>
      <dt className="text-slate-500">{k}</dt>
      <dd className="font-medium text-slate-900">{v || "—"}</dd>
    </div>
  );

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      <PageHeader title="Company" subtitle={tenant.name} breadcrumb={[{ label: "Settings", href: "/settings" }]} />

      <Card className="amb-fade-in">
        <CardHeader title="In Backend" subtitle="The legal company and its tax identity live here. Change them in Backend." />
        <div className="px-5 pb-5">
          {erp.status === "ok" ? (
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              {row("Company", erp.name)}
              {row("Abbreviation", erp.abbr)}
              {row("GSTIN / tax ID", erp.taxId)}
              {row("Currency", erp.currency)}
              {row("Country", erp.country)}
              <div>
                <dt className="text-slate-500">Status</dt>
                <dd>
                  <StatusBadge tone="success">Connected</StatusBadge>
                </dd>
              </div>
            </dl>
          ) : erp.status === "not_connected" ? (
            <ConnectErp status={tenant.erpnextProvisionStatus} error={tenant.erpnextProvisionError} />
          ) : (
            <p role="status" className="flex items-center gap-2 text-sm text-amber-900">
              <StatusBadge tone="warning">Unreachable</StatusBadge> Backend didn&apos;t answer just now. Your AMBURAX records are unaffected.
            </p>
          )}
        </div>
      </Card>

      <Card className="amb-fade-in">
        <CardHeader title="In AMBURAX" />
        <dl className="grid gap-4 px-5 pb-5 text-sm sm:grid-cols-3">
          {row("Business name", tenant.name)}
          {row("Tax ID on file", tenant.taxId)}
          {row("Country", tenant.country)}
          {row("Contact email", tenant.contactEmail)}
          {row("Contact phone", tenant.contactPhone)}
          {row("Backend site", tenant.erpnextProvisionStatus.replace(/_/g, " ").toLowerCase())}
        </dl>
        {erp.status === "ok" && erp.taxId && tenant.taxId && erp.taxId.toUpperCase() !== tenant.taxId.toUpperCase() && (
          <p role="alert" className="mx-5 mb-5 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
            The tax ID here differs from Backend&apos;s. Backend&apos;s is the one used on documents; correct whichever is wrong.
          </p>
        )}
      </Card>

      {!tenant.taxId?.trim() && <GstRegistration />}

      {companies.map((c) => (
        <Card key={c.id} className="amb-fade-in">
          <CardHeader
            title={c.name}
            subtitle={`${c.code} · ${c.currency} · ${c.stores.length} ${c.stores.length === 1 ? "store" : "stores"}`}
            action={
              <StatusBadge tone={erp.status === "ok" ? "success" : "neutral"}>
                {erp.status === "ok" ? "Backend Linked" : "Local Only"}
              </StatusBadge>
            }
          />
          <div className="border-b border-slate-100 bg-slate-50/60 px-5 py-2 text-xs text-slate-500">
            Stores mapped to Backend dedicated warehouses for automated stock movements &amp; accounting entries.
          </div>
          <ul className="divide-y divide-slate-100 px-5 pb-5 text-sm">
            {c.stores.map((s) => (
              <li key={s.id} className="flex min-h-11 items-center justify-between gap-3 py-2">
                <span className="flex items-center gap-2">
                  <Building2 aria-hidden="true" className="h-4 w-4 text-slate-500" />
                  <span className="font-medium text-slate-900">{s.name}</span>
                  <span className="text-slate-500">
                    {s.code} · {s.state}
                  </span>
                  <span className="ml-2 inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                    Warehouse: Stores - {s.code}
                  </span>
                </span>
                <Link href={`/stores/${s.id}`} className="amb-focus inline-flex min-h-11 items-center gap-1 rounded px-2 text-sky-700 hover:bg-sky-50">
                  Figures <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
