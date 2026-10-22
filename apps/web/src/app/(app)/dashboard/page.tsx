import { redirect } from "next/navigation";
import { Calendar } from "lucide-react";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolveSession } from "@/server/identity/session";
import { getOnboardingResume } from "@/server/onboarding/resume";
import { resolvePosContext, type PosContext } from "@/server/sales/posContext";
import { getTenantCapabilities } from "@/server/tenant/capabilities";
import {
  getPaymentMix,
  getSalesBreakdown,
  getSalesTrend,
  getShiftActivity,
  getStockSignal,
  getTodayMetrics,
  startOfStoreDay,
} from "@/server/dashboard/dashboardQueries";
import {
  canViewShiftActivity,
  canViewStockSignal,
  canViewStoreAnalytics,
} from "@/server/dashboard/dashboardAccess";
import { formatTradingDay, greetingFor } from "@/server/dashboard/dashboardTransforms";
import { listSales } from "@/server/sales/saleQueries";
import { db } from "@/server/db";
import { KpiGrid } from "@/components/dashboard/KpiGrid";
import { SalesTrendCard } from "@/components/dashboard/SalesTrendCard";
import { CategorySalesCard, PaymentMethodsCard } from "@/components/dashboard/AnalyticsCards";
import {
  FastMovingProductsCard,
  RecentSalesCard,
  StockSignalCard,
} from "@/components/dashboard/OperationsCards";
import {
  NextStepBanner,
  ShiftStatusCard,
  SystemStatusCard,
  TargetsCard,
} from "@/components/dashboard/BusinessCards";
import {
  DashboardCard,
  DashboardCardHeader,
  WidgetUnavailable,
} from "@/components/dashboard/primitives";

/**
 * The dashboard — the landing workspace after sign-in.
 *
 * A server component, and deliberately: every figure on the screen is a database aggregate,
 * so the page fetches them in parallel and ships HTML. The only thing that reaches the
 * browser is the trend card, because it alone has state (the range switch).
 *
 * The composition is capability- and role-aware rather than a fixed retail layout. What a
 * tenant has switched on decides which widgets are eligible; what the viewer's role is
 * decides which of those are worth their screen. Both are presentation decisions — the
 * queries below are already scoped to the tenant and store the session resolved to, and no
 * identifier on this page comes from the client.
 *
 * It also keeps the onboarding resume guard (ADR-075): every authenticated entry path lands
 * here, so this is the one place that decides whether setup is still unfinished.
 */

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
        <DashboardCard className="p-8 text-center">
          <div role="alert">
            <p className="text-base font-semibold text-primary">
              We can&apos;t safely continue your setup
            </p>
            <p className="mt-2 text-sm text-secondary">
              Your business is in an unexpected state. Please contact support — nothing
              you&apos;ve entered has been lost.
            </p>
          </div>
        </DashboardCard>
      </div>
    );
  }

  let context: PosContext;
  let capabilities: string[] = [];
  let metrics: Awaited<ReturnType<typeof getTodayMetrics>>;
  let averageDayMinor: number | null = null;
  let erpConnected = false;
  let stock: Awaited<ReturnType<typeof getStockSignal>>;
  let breakdown: Awaited<ReturnType<typeof getSalesBreakdown>>;
  let payments: Awaited<ReturnType<typeof getPaymentMix>>;
  let shift: Awaited<ReturnType<typeof getShiftActivity>>;
  let trend: Awaited<ReturnType<typeof getSalesTrend>>;
  let recent: Awaited<ReturnType<typeof listSales>>;

  try {
    const resolved = await resolvePosContext(token);
    if (resolved.status === "unauthorized") redirect("/auth/login");
    if (resolved.status === "no_store") redirect("/onboarding/store");

    context = resolved.context;
    const scope = { tenantId: context.tenantId, storeId: context.storeId };

    // Every load is independent, so they run together rather than in a waterfall. Each is a
    // narrow aggregate — no widget on this page pulls a full table to count it.
    ({ averageDayMinor, erpConnected } = await getPaceAndErp(scope));

    [capabilities, metrics, stock, breakdown, payments, shift, trend, recent] = await Promise.all([
      getTenantCapabilities(context.tenantId),
      getTodayMetrics(scope),
      getStockSignal(scope),
      getSalesBreakdown(scope),
      getPaymentMix(scope),
      getShiftActivity(scope),
      getSalesTrend({ ...scope, range: "today" }),
      listSales({ ...scope, limit: 6 }),
    ]);
  } catch (err) {
    logError("dashboard: metrics load failed", err);
    return <ServiceUnavailableScreen />;
  }

  const viewer = { tenantRole: context.tenantRole, membershipRole: context.membershipRole };
  const showAnalytics = canViewStoreAnalytics(viewer);
  const showShift = canViewShiftActivity(viewer);
  const showStock = canViewStockSignal(viewer);

  // Capability gates. A payment split and a shift panel are statements about a counter, so
  // they belong to the retail capability; a tenant running wholesale-only has neither.
  const hasRetail = capabilities.includes("RETAIL");
  const hasWholesale = capabilities.includes("WHOLESALE");
  const showPaymentMix = showAnalytics && hasRetail;

  return (
    <main className="flex-1 w-full p-4 pb-12 sm:p-6 lg:p-8">
      <header className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-[22px] font-bold tracking-[-0.01em] text-slate-900">
            {greetingFor()}, {context.userName.split(' ')[0]} <span aria-hidden="true">👋</span>
          </h1>
          <p className="mt-1 text-[11.5px] text-slate-500">
            Here&apos;s what&apos;s happening at {context.storeName} today.
          </p>
        </div>
        
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 shadow-sm">
            <Calendar size={13} className="text-slate-400" />
            {formatTradingDay(startOfStoreDay())}
          </div>
        </div>
      </header>

      <KpiGrid metrics={metrics} stock={stock} />

      {/* The reference's middle-row proportions, but only at the width that can hold three
          columns; below that they wrap rather than compress into slivers. */}
      {showAnalytics && (
        <section className="mt-4 grid gap-4 xl:grid-cols-[56fr_24fr_20fr]">
          <SalesTrendCard
            initialRange="today"
            initialPoints={trend.map((point) => ({
              label: point.label,
              salesMinor: point.salesMinor,
              billCount: point.billCount,
            }))}
          />
          <CategorySalesCard
            categories={breakdown.categories}
            uncategorisedMinor={breakdown.uncategorisedMinor}
          />
          {showPaymentMix && (
            <PaymentMethodsCard rows={payments.rows} totalMinor={payments.totalMinor} />
          )}
        </section>
      )}

      <section className="mt-4 grid gap-4 xl:grid-cols-3">
        <FastMovingProductsCard products={breakdown.topProducts} />
        {showStock && <StockSignalCard stock={stock} />}
        <RecentSalesCard sales={recent} />
      </section>

      <section className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {stock.uncountedVariants > 0 ? (
          <NextStepBanner uncountedVariants={stock.uncountedVariants} />
        ) : null}
        {showShift && hasRetail && <ShiftStatusCard activity={shift} />}
        {hasWholesale && (
          <div className="surface-card rounded-lg p-4 flex flex-col h-full">
            <div className="flex items-center justify-between">
              <h2 className="text-[12px] font-bold text-slate-800">B2B orders</h2>
            </div>
            <div className="mt-3 flex-1 flex flex-col justify-center rounded-xl border border-dashed border-slate-200 px-4 py-6">
              <p className="text-[11px] font-semibold text-slate-600">Not available yet</p>
              <p className="mt-1 text-[9px] text-slate-400">Wholesale ordering is enabled for this business but the module has not shipped, so there are no B2B figures to report.</p>
            </div>
          </div>
        )}
        <TargetsCard metrics={metrics} averageDayMinor={averageDayMinor} />
        <SystemStatusCard activity={shift} stock={stock} erpConnected={erpConnected} />
      </section>

      <p className="text-xs text-tertiary">
        Figures cover today&apos;s trading day in {context.storeName} and update as sales are
        completed.
      </p>
    </main>
  );
}

/** The store's own average day over the last 30 trading days (today excluded), and whether ERPNext is connected. */
async function getPaceAndErp(scope: { tenantId: string; storeId: string }) {
  const dayMs = 864e5;
  const istOffset = 330 * 60_000;
  const todayStart = new Date(Math.floor((Date.now() + istOffset) / dayMs) * dayMs - istOffset);
  const [past30, tenantRow] = await Promise.all([
    db.sale.aggregate({
      where: { ...scope, status: "COMPLETED", createdAt: { gte: new Date(todayStart.getTime() - 30 * dayMs), lt: todayStart } },
      _sum: { totalMinor: true },
    }),
    db.tenant.findUnique({ where: { id: scope.tenantId }, select: { erpnextProvisionStatus: true } }),
  ]);
  return {
    averageDayMinor: past30._sum.totalMinor ? Math.round(past30._sum.totalMinor / 30) : null,
    erpConnected: tenantRow?.erpnextProvisionStatus === "PROVISIONED",
  };
}
