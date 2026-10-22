import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { formatMinor } from "@/server/sales/saleTotals";
import { getMultiStore } from "@/server/ops/operations";
import { INDIAN_STATES } from "@/lib/gstStates";
import { AddStoreForm } from "./AddStoreForm";
import { DataTable, PageHeader, PermissionDeniedState, StatusBadge, Td, Th } from "../_components/ui";

const pct = (bp: number | null) => (bp == null ? "—" : `${(bp / 100).toFixed(1)}%`);
const WINDOWS = [7, 30, 90] as const;

/**
 * Multi-store overview and comparison (screens 69, 71): every store side by side. Margin is gross
 * profit on costed lines before returns, as in Reports; uncosted units are counted, never guessed.
 */
export default async function StoresPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const raw = Number((await searchParams).days);
  const days = (WINDOWS as readonly number[]).includes(raw) ? raw : 30;
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("stores: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  if (ctx.tenantRole !== "OWNER") {
    return (
      <div className="px-4 py-6 sm:px-6">
        <PageHeader title="Stores" />
        <PermissionDeniedState title="Store comparison is for the owner" description="It shows every store's takings and margin." />
      </div>
    );
  }
  let stores: Awaited<ReturnType<typeof getMultiStore>>;
  try {
    stores = await getMultiStore({ tenantId: ctx.tenantId, days });
  } catch (err) {
    logError("stores: load failed", err);
    return <ServiceUnavailableScreen />;
  }
  const total = stores.reduce((s, x) => s + x.salesMinor, 0);
  const best = Math.max(0, ...stores.map((s) => s.salesMinor));

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      <PageHeader
        title="Stores"
        subtitle={`${stores.length} ${stores.length === 1 ? "store" : "stores"} · ${formatMinor(total)} in the last ${days} days`}
        actions={
          <nav aria-label="Period" className="flex gap-1 rounded-lg bg-slate-100 p-1">
            {WINDOWS.map((d) => (
              <Link
                key={d}
                href={`/stores?days=${d}`}
                aria-current={d === days ? "page" : undefined}
                className={`amb-focus inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold transition-colors ${d === days ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
              >
                {d} days
              </Link>
            ))}
          </nav>
        }
      />

      <AddStoreForm states={INDIAN_STATES} />

      <DataTable caption={`Stores compared over the last ${days} days`}>
        <thead>
          <tr>
            <Th>Store</Th>
            <Th align="right">Today</Th>
            <Th align="right">Sales ({days}d)</Th>
            <Th align="right">Bills</Th>
            <Th align="right">Avg bill</Th>
            <Th align="right">Gross margin</Th>
            <Th align="right">Net margin</Th>
            <Th align="right">Stock at cost</Th>
            <Th>Tills</Th>
          </tr>
        </thead>
        <tbody>
          {stores.map((s) => (
            <tr key={s.storeId} className="amb-line-in">
              <Td>
                <Link href={`/stores/${s.storeId}?days=${days}`} className="amb-focus font-medium text-sky-800 hover:underline">
                  {s.name}
                </Link>
                <span className="block text-xs text-slate-500">
                  {s.code} · {s.city}, {s.state}
                </span>
              </Td>
              <Td align="right" className="tabular-nums">
                {formatMinor(s.todaySalesMinor)}
              </Td>
              <Td align="right" className="tabular-nums">
                <span className="font-medium text-slate-900">{formatMinor(s.salesMinor)}</span>
                <span aria-hidden="true" className="mt-1 block h-1.5 rounded-full bg-slate-100">
                  <span className="block h-1.5 rounded-full bg-primary" style={{ width: `${best > 0 ? Math.round((s.salesMinor / best) * 100) : 0}%` }} />
                </span>
              </Td>
              <Td align="right" className="tabular-nums">
                {s.bills}
              </Td>
              <Td align="right" className="tabular-nums">
                {s.averageBillMinor == null ? "—" : formatMinor(s.averageBillMinor)}
              </Td>
              <Td align="right" className="tabular-nums">
                {pct(s.marginBp)}
                {s.uncostedUnits > 0 && <span className="block text-xs text-amber-800">{s.uncostedUnits} units uncosted</span>}
              </Td>
              <Td align="right" className="tabular-nums">
                <span className={s.netMarginBp !== null && s.netMarginBp < 0 ? "text-rose-700" : "text-emerald-700"}>
                  {pct(s.netMarginBp)}
                </span>
                <span className="block text-xs text-slate-400">post-returns</span>
              </Td>
              <Td align="right" className="tabular-nums">
                {s.stockValueMinor == null ? "—" : formatMinor(s.stockValueMinor)}
                {s.valueIncludesEstimate && <span className="block text-xs text-amber-800">includes estimate</span>}
              </Td>
              <Td>{s.openTills > 0 ? <StatusBadge tone="success">{s.openTills} open</StatusBadge> : <StatusBadge tone="neutral">Closed</StatusBadge>}</Td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <p className="text-xs text-slate-500">Sales are net of GST. Gross margin is before customer returns; net margin accounts for refunded returns.</p>
    </div>
  );
}
