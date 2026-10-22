import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { formatMinor } from "@/server/sales/saleTotals";
import { IndianRupee, Package, Percent, Receipt } from "lucide-react";
import { getMultiStore } from "@/server/ops/operations";
import { db } from "@/server/db";
import { Card, CardHeader, KpiCard, PageHeader, PermissionDeniedState } from "../../_components/ui";

const pct = (bp: number | null) => (bp == null ? "—" : `${(bp / 100).toFixed(1)}%`);

/** Store detail (screen 70): one store's figures, address, company and ERPNext warehouse. */
export default async function StoreDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ storeId: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { storeId } = await params;
  const raw = Number((await searchParams).days);
  const days = [7, 30, 90].includes(raw) ? raw : 30;
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("store detail: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  if (ctx.tenantRole !== "OWNER") {
    return (
      <div className="px-4 py-6 sm:px-6">
        <PageHeader title="Store" />
        <PermissionDeniedState title="Store details are for the owner" description="They show the store's takings and margin." />
      </div>
    );
  }
  let figures: Awaited<ReturnType<typeof getMultiStore>>;
  let store;
  try {
    [figures, store] = await Promise.all([
      getMultiStore({ tenantId: ctx.tenantId, days, onlyStoreId: storeId }),
      db.store.findFirst({
        where: { id: storeId, tenantId: ctx.tenantId },
        select: { addressLine: true, city: true, state: true, postalCode: true, phone: true, erpnextWarehouseId: true, company: { select: { name: true } } },
      }),
    ]);
  } catch (err) {
    logError("store detail: load failed", err);
    return <ServiceUnavailableScreen />;
  }
  const f = figures[0];
  if (!f || !store) notFound();

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      <PageHeader title={f.name} subtitle={`${f.code} · last ${days} days`} breadcrumb={[{ label: "Stores", href: `/stores?days=${days}` }]} />
      <section aria-label="Figures" className="amb-fade-in grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label={`Sales (${days}d)`} value={formatMinor(f.salesMinor)} hint={`${f.bills} bills · today ${formatMinor(f.todaySalesMinor)}`} icon={<IndianRupee className="h-5 w-5" />} />
        <KpiCard label="Average bill" value={f.averageBillMinor == null ? "—" : formatMinor(f.averageBillMinor)} icon={<Receipt className="h-5 w-5" />} />
        <KpiCard label="Gross margin" value={pct(f.marginBp)} hint={f.uncostedUnits > 0 ? `${f.uncostedUnits} units uncosted` : `${formatMinor(f.profitMinor)} profit`} icon={<Percent className="h-5 w-5" />} tone="emerald" />
        <KpiCard label="Stock at cost" value={f.stockValueMinor == null ? "—" : formatMinor(f.stockValueMinor)} hint={`${f.outOfStock} out of stock`} icon={<Package className="h-5 w-5" />} tone="amber" />
      </section>
      <Card className="amb-fade-in">
        <CardHeader title="Store" />
        <dl className="grid gap-4 px-5 pb-5 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Address</dt>
            <dd className="text-slate-900">
              {store.addressLine}, {store.city}, {store.state} {store.postalCode ?? ""}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Phone</dt>
            <dd className="text-slate-900">{store.phone ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Company</dt>
            <dd className="text-slate-900">{store.company?.name ?? "Not linked"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Backend warehouse</dt>
            <dd className="text-slate-900">{store.erpnextWarehouseId ?? "Not provisioned"}</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
