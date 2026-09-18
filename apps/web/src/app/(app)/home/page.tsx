import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolveSession } from "@/server/identity/session";
import { getOnboardingResume } from "@/server/onboarding/resume";
import { resolvePosContext, type PosContext } from "@/server/sales/posContext";
import {
  getTodayMetrics,
  getStockSignal,
  startOfStoreDay,
  type DashboardTodayMetrics,
  type DashboardStockSignal,
} from "@/server/dashboard/dashboardQueries";
import { listSales, type SaleListRow } from "@/server/sales/saleQueries";
import { formatMinor } from "@/server/sales/saleTotals";
import { formatDateTime, formatTime } from "../sales/formatDateTime";
import {
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  KpiCard,
  LinkButton,
  PageHeader,
  QuickAction,
  StatusBadge,
  StockBadge,
  Td,
  Th,
} from "../_components/ui";

/**
 * The dashboard — the landing workspace after sign-in.
 *
 * Every figure on this screen is computed from real rows for the signed-in tenant and
 * store. Where the data cannot support a metric the design reference shows, the metric is
 * absent rather than estimated: there is no inventory value (no cost price exists), no
 * growth arrows (no defined comparison period), no category or payment breakdown, no
 * targets and no staff shift panel.
 *
 * This page also keeps the onboarding resume guard (ADR-075): every authenticated entry
 * path lands here, so this is the one place that decides whether setup is still unfinished.
 */

function greeting(now: Date = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      hour12: false,
    }).format(now),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;

  // Only the data loads are wrapped, never redirect() — Next implements it by throwing, so
  // catching around it would swallow the navigation.
  let session: Awaited<ReturnType<typeof resolveSession>>;
  let resume: Awaited<ReturnType<typeof getOnboardingResume>> = { path: null, inconsistent: false };
  try {
    session = token ? await resolveSession(token) : null;
    if (session) {
      resume = await getOnboardingResume({
        tenantId: session.tenantId,
        tenantRole: session.user.tenantRole,
      });
    }
  } catch (err) {
    logError("dashboard: session resolution failed", err);
    return <ServiceUnavailableScreen />;
  }

  if (!session) redirect("/auth/login");
  if (resume.path) redirect(resume.path);

  // Reached only when the tenant's step implies a Store that does not exist. Resuming would
  // loop (/pos -> /store -> /home -> /pos), so the guard stops here and says why.
  if (resume.inconsistent) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <Card className="p-8 text-center">
          <div role="alert">
            <StatusBadge tone="warning">Setup incomplete</StatusBadge>
            <p className="mt-4 text-base font-semibold text-slate-900">
              We can&apos;t safely continue your setup
            </p>
            <p className="mt-2 text-sm text-slate-600">
              Your business is in an unexpected state. Please contact support — nothing
              you&apos;ve entered has been lost.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  let context: PosContext | null = null;
  let metrics: DashboardTodayMetrics | null = null;
  let stock: DashboardStockSignal | null = null;
  let recent: SaleListRow[] = [];

  try {
    const resolved = await resolvePosContext(token);
    if (resolved.status === "unauthorized") redirect("/auth/login");
    if (resolved.status === "no_store") redirect("/onboarding/store");

    context = resolved.context;
    [metrics, stock, recent] = await Promise.all([
      getTodayMetrics({ tenantId: context.tenantId, storeId: context.storeId }),
      getStockSignal({ tenantId: context.tenantId, storeId: context.storeId }),
      listSales({ tenantId: context.tenantId, storeId: context.storeId, limit: 8 }),
    ]);
  } catch (err) {
    logError("dashboard: metrics load failed", err);
    return <ServiceUnavailableScreen />;
  }

  const tradingDay = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "full",
    timeZone: "Asia/Kolkata",
  }).format(startOfStoreDay());

  return (
    <div className="px-4 py-6 sm:px-6">
      <PageHeader
        title={`${greeting()}, ${context.userName}`}
        subtitle={`${context.storeName} · #${context.storeCode} — ${tradingDay}`}
        actions={
          context.canSell ? (
            <LinkButton href="/pos">+ New Sale</LinkButton>
          ) : (
            <StatusBadge tone="neutral">View only in this store</StatusBadge>
          )
        }
      />

      {/* Four figures, each a direct aggregate of today's committed rows. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Today's sales"
          value={formatMinor(metrics.salesMinor)}
          hint={
            metrics.averageBillMinor === null
              ? "No sales yet today"
              : `Average bill ${formatMinor(metrics.averageBillMinor)}`
          }
          tone="blue"
        />
        <KpiCard
          label="Bills"
          value={String(metrics.billCount)}
          hint="Completed sales today"
          tone="violet"
        />
        <KpiCard
          label="Items sold"
          value={String(metrics.itemsSold)}
          hint="Units across today's bills"
          tone="emerald"
        />
        <KpiCard
          label="New customers"
          value={String(metrics.newCustomers)}
          hint="Added today"
          tone="amber"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Recent sales"
            subtitle="Most recent completed bills in this store"
            action={
              <Link href="/sales" className="text-xs font-medium text-blue-600 hover:underline">
                View all
              </Link>
            }
          />
          {recent.length === 0 ? (
            <EmptyState
              title="No sales yet"
              description="Completed sales in this store will appear here."
              action={
                context.canSell ? <LinkButton href="/pos">Open the till</LinkButton> : undefined
              }
            />
          ) : (
            <DataTable caption="Recent sales">
              <thead className="border-b border-slate-100">
                <tr>
                  <Th>Time</Th>
                  <Th>Bill no.</Th>
                  <Th>Customer</Th>
                  <Th align="right">Amount</Th>
                  <Th>Payment</Th>
                  <Th>Accounting</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {recent.map((sale) => (
                  <tr key={sale.id} className="hover:bg-slate-50">
                    <Td className="whitespace-nowrap text-slate-500">
                      {formatTime(sale.completedAt)}
                    </Td>
                    <Td>
                      <Link
                        href={`/sales/${sale.id}`}
                        className="font-medium text-blue-600 hover:underline"
                      >
                        {sale.billNumber}
                      </Link>
                    </Td>
                    <Td className="text-slate-600">{sale.customerName ?? "Walk-in"}</Td>
                    <Td align="right" className="font-medium text-slate-900">
                      {formatMinor(sale.totalMinor)}
                    </Td>
                    <Td className="text-slate-600">{sale.paymentMethod ?? "—"}</Td>
                    <Td>
                      {/* No ERPNext adapter exists, so this is always "not posted" today.
                          Showing it per row is what stops the list implying the books are
                          up to date. */}
                      {sale.erpSyncStatus === "SYNCED" ? (
                        <StatusBadge tone="success">Posted</StatusBadge>
                      ) : (
                        <StatusBadge tone="warning">Not posted</StatusBadge>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Stock signal"
            subtitle="AMBURAX operational count — not an accounting stock ledger"
            action={
              <Link href="/inventory" className="text-xs font-medium text-blue-600 hover:underline">
                Inventory
              </Link>
            }
          />
          <div className="grid grid-cols-2 gap-px bg-slate-100">
            <div className="bg-white px-5 py-4">
              <p className="text-xs text-slate-500">Counted here</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{stock.countedVariants}</p>
            </div>
            <div className="bg-white px-5 py-4">
              <p className="text-xs text-slate-500">Never counted</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{stock.uncountedVariants}</p>
            </div>
            <div className="bg-white px-5 py-4">
              <p className="text-xs text-slate-500">Out of stock</p>
              <p className="mt-1 text-xl font-semibold text-amber-600">{stock.outOfStock}</p>
            </div>
            <div className="bg-white px-5 py-4">
              <p className="text-xs text-slate-500">Oversold</p>
              <p className="mt-1 text-xl font-semibold text-rose-600">{stock.oversold}</p>
            </div>
          </div>

          {stock.lowest.length > 0 && (
            <div className="border-t border-slate-100 px-5 py-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Lowest counts
              </p>
              <ul className="mt-2 space-y-2">
                {stock.lowest.map((row) => (
                  <li key={row.variantId} className="flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-slate-900">
                        {row.productName}
                      </span>
                      <span className="block text-xs text-slate-400">{row.sku}</span>
                    </span>
                    <StockBadge quantity={row.quantity} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/*
            There is no reorder-level column in the schema, so this panel never claims "low
            stock" — that would be a threshold the data cannot support (ADR-080).
          */}
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400">
            No reorder levels are configured yet, so AMBURAX doesn&apos;t flag low stock —
            only what it has actually counted.
          </p>
        </Card>
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-slate-900">Quick actions</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {context.canSell && <QuickAction href="/pos" label="New sale" hint="F2" />}
          <QuickAction href="/products" label="Products" hint="Catalogue" />
          <QuickAction href="/customers" label="Customers" hint="Records" />
          <QuickAction href="/sales" label="Sales" hint="History" />
        </div>
      </div>

      <p className="mt-6 text-xs text-slate-400">
        Figures cover today&apos;s trading day in {context.storeName} and update as sales are
        completed. Last loaded {formatDateTime(new Date())}.
      </p>
    </div>
  );
}
