import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ArrowDownLeft, ArrowUpRight, MapPin, Warehouse } from "lucide-react";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { formatMinor } from "@/server/sales/saleTotals";
import { listLocations, type LocationRow } from "@/server/inventory/locations";
import { EmptyState, KpiCard, PageHeader, StatusBadge } from "../../_components/ui";

/** Warehouse / location overview (screen 35): stock by store, each mapped to its ERPNext warehouse. */
export default async function LocationsPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("locations: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  let rows: LocationRow[];
  try {
    rows = await listLocations({ tenantId: ctx.tenantId, userId: ctx.userId, tenantRole: ctx.tenantRole });
  } catch (err) {
    logError("locations: load failed", err);
    return <ServiceUnavailableScreen />;
  }

  const totalUnits = rows.reduce((s, r) => s + r.units, 0);
  const totalValue = rows.reduce((s, r) => s + r.valueMinor, 0);
  const transit = rows.reduce((s, r) => s + r.inTransitOut, 0);

  return (
    <div className="px-4 py-6 sm:px-6">
      <PageHeader
        title="Locations"
        subtitle="Stock held at each store you can reach. Every store is one warehouse in Backend."
        breadcrumb={[{ label: "Inventory", href: "/inventory" }]}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Locations" value={String(rows.length)} hint="Stores you can see" />
        <KpiCard label="Units on hand" value={totalUnits.toLocaleString("en-IN")} hint="Across these stores" tone="emerald" />
        <KpiCard
          label="In transit"
          value={transit.toLocaleString("en-IN")}
          hint="Sent between stores, not yet received"
          tone="violet"
        />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          <EmptyState icon={<Warehouse className="h-5 w-5" />} title="No stores" description="You don't have access to a store yet." />
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Locations">
          {rows.map((r, i) => (
            <li
              key={r.storeId}
              className="cust-rise amb-lift flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-sky-200 hover:shadow-md"
              style={{ ["--i" as string]: i }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-slate-900">
                    {r.name}
                    {r.storeId === ctx.storeId && <span className="ml-2 text-xs font-medium text-sky-700">Current</span>}
                  </h2>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                    <MapPin aria-hidden="true" className="h-3.5 w-3.5" />
                    {r.code} · {r.city}
                  </p>
                </div>
                {r.erpStatus === "PROVISIONED" && r.erpWarehouse ? (
                  <StatusBadge tone="success">Backend linked</StatusBadge>
                ) : (
                  <StatusBadge tone="warning">Not in Backend yet</StatusBadge>
                )}
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Items in stock</dt>
                  <dd className="font-semibold tabular-nums text-slate-900">{r.itemsInStock.toLocaleString("en-IN")}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Units</dt>
                  <dd className="font-semibold tabular-nums text-slate-900">{r.units.toLocaleString("en-IN")}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Value at cost</dt>
                  <dd className="font-semibold tabular-nums text-slate-900">
                    {r.valueMinor > 0 ? formatMinor(r.valueMinor) : "—"}
                    {r.uncosted > 0 && (
                      <span className="block text-xs font-normal text-slate-500">{r.uncosted} without a cost</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Low / out</dt>
                  <dd className="font-semibold tabular-nums">
                    <span className="text-amber-800">{r.low}</span>
                    <span className="text-slate-500"> / </span>
                    <span className="text-rose-700">{r.out}</span>
                  </dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-3 border-t border-slate-100 pt-3 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1">
                  <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 text-violet-600" />
                  {r.inTransitOut} units leaving
                </span>
                <span className="inline-flex items-center gap-1">
                  <ArrowDownLeft aria-hidden="true" className="h-3.5 w-3.5 text-emerald-600" />
                  {r.inTransitIn} units arriving
                </span>
                {r.erpWarehouse && <span className="ml-auto font-mono text-slate-500">{r.erpWarehouse}</span>}
              </div>

              {r.storeId === ctx.storeId && (
                <div className="mt-3 flex gap-2">
                  <Link
                    href="/inventory/replenishment"
                    className="amb-focus inline-flex min-h-11 items-center rounded-lg px-3 text-xs font-semibold text-sky-700 hover:bg-sky-50"
                  >
                    Replenish
                  </Link>
                  <Link
                    href="/inventory/transfers/new"
                    className="amb-focus inline-flex min-h-11 items-center rounded-lg px-3 text-xs font-semibold text-sky-700 hover:bg-sky-50"
                  >
                    Send stock
                  </Link>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 text-xs text-slate-500">
        Total value at cost {totalValue > 0 ? formatMinor(totalValue) : "—"} (weighted average, excl. GST). Low means 1–10
        units on hand.
      </p>
    </div>
  );
}
