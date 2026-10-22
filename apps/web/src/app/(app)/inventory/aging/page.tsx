import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Hourglass } from "lucide-react";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { formatMinor } from "@/server/sales/saleTotals";
import { AGING_WINDOWS, isAgingWindow, listAgingStock, type AgingWindow } from "@/server/inventory/aging";
import { DataTable, EmptyState, KpiCard, PageHeader, Td, Th } from "../../_components/ui";
import { formatDateOnly } from "../../sales/formatDateTime";

/** Aging / dead stock (screen 33): stock that hasn't sold in the chosen window. */
export default async function AgingPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const requested = Number((await searchParams).days);
  const days: AgingWindow = isAgingWindow(requested) ? requested : 90;
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("aging: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  let data: Awaited<ReturnType<typeof listAgingStock>>;
  try {
    data = await listAgingStock({ tenantId: ctx.tenantId, storeId: ctx.storeId, days });
  } catch (err) {
    logError("aging: load failed", err);
    return <ServiceUnavailableScreen />;
  }

  return (
    <div className="px-4 py-6 sm:px-6">
      <PageHeader
        title="Aging stock"
        subtitle={`Items in ${ctx.storeName} with no sale in the last ${days} days, oldest first.`}
        breadcrumb={[{ label: "Inventory", href: "/inventory" }]}
      />

      <nav aria-label="Window" className="mb-5 flex w-fit rounded-lg bg-slate-100 p-0.5">
        {AGING_WINDOWS.map((d) => (
          <Link
            key={d}
            href={`/inventory/aging?days=${d}`}
            aria-current={d === days ? "page" : undefined}
            className={`amb-focus inline-flex min-h-11 items-center rounded-md px-4 text-sm font-semibold transition-colors ${
              d === days ? "bg-white text-sky-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {d} days
          </Link>
        ))}
      </nav>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <KpiCard label="Items" value={String(data.rows.length)} hint="With stock, not sold in this window" />
        <KpiCard label="Units" value={String(data.totalUnits)} hint="On the shelf" />
        <KpiCard
          label="Value at cost"
          value={data.totalValueMinor > 0 ? formatMinor(data.totalValueMinor) : "—"}
          hint={
            data.uncostedItems > 0
              ? `${data.uncostedItems} items have no recorded cost`
              : "Weighted average cost, excl. GST"
          }
        />
      </div>

      {data.rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          <EmptyState
            icon={<Hourglass className="h-5 w-5" />}
            title="Nothing aging"
            description={`Everything on the shelf has sold at least once in the last ${days} days.`}
          />
        </div>
      ) : (
        <DataTable caption={`Items not sold in ${days} days`}>
          <thead>
            <tr>
              <Th>Item</Th>
              <Th align="right">On hand</Th>
              <Th>Last sold</Th>
              <Th align="right">Value at cost</Th>
              <Th align="right">Clearance Suggestion</Th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const clearancePercent = days >= 180 ? 40 : days >= 90 ? 25 : 15;

              return (
                <tr key={r.variantId} className="hover:bg-slate-50/50">
                  <Td>
                    <span className="font-medium text-slate-900">{r.productName}</span>
                    <span className="block font-mono text-xs text-slate-500">
                      {[r.sku, r.size, r.colour].filter(Boolean).join(" · ")}
                    </span>
                  </Td>
                  <Td align="right" className="tabular-nums font-semibold">
                    {r.quantity}
                  </Td>
                  <Td>
                    {r.lastSoldAt ? (
                      <div>
                        <span>{formatDateOnly(r.lastSoldAt)}</span>
                        {r.daysUnsold !== null && (
                          <span className="block text-[10px] text-slate-400 font-mono">
                            {r.daysUnsold} days idle
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200">
                        Dead Stock (Never Sold)
                      </span>
                    )}
                  </Td>
                  <Td align="right" className="tabular-nums font-mono text-slate-700">
                    {r.valueMinor === null ? "—" : formatMinor(r.valueMinor)}
                  </Td>
                  <Td align="right">
                    <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-700 ring-1 ring-rose-200">
                      {clearancePercent}% Off Flash Sale
                    </span>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
