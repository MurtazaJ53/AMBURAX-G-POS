import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { canAuthorizeReturn } from "@/server/sales/returnRoles";
import { db } from "@/server/db";
import {
  listSalesPage,
  getSalesSummary,
  getSalesAnalytics,
  type SalesPage,
  type SalesSummary,
  type SalesAnalytics,
} from "@/server/sales/saleQueries";
import { LinkButton } from "../_components/ui";
import { SalesWorkspace } from "./_components/SalesWorkspace";
import { Download } from "lucide-react";
// Shared with the CSV export so the screen and the file read filters identically.
import { parseDate, parseMethod, parseStatus } from "@/server/sales/salesFilterParams";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    method?: string;
    status?: string;
    from?: string;
    to?: string;
    page?: string;
    cashierId?: string;
    minAmount?: string;
    maxAmount?: string;
  }>;
}) {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const sp = await searchParams;

  const query = (sp.q ?? "").slice(0, 100);
  const method = parseMethod(sp.method);
  const status = parseStatus(sp.status);
  const from = parseDate(sp.from);
  const to = parseDate(sp.to, true);
  const page = Number.parseInt(sp.page ?? "1", 10) || 1;
  const cashierId = sp.cashierId?.trim() || undefined;
  const minAmountMinor = sp.minAmount ? Math.round(Number(sp.minAmount) * 100) : undefined;
  const maxAmountMinor = sp.maxAmount ? Math.round(Number(sp.maxAmount) * 100) : undefined;

  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("sales: context resolution failed", err);
    return <ServiceUnavailableScreen />;
  }

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/dashboard");
  const context = resolved.context;

  const filters = {
    tenantId: context.tenantId,
    storeId: context.storeId,
    query,
    method,
    status,
    from,
    to,
    cashierId,
    minAmountMinor,
    maxAmountMinor,
  };

  let result: SalesPage;
  let summary: SalesSummary;
  let analytics: SalesAnalytics;
  let cashiers: { id: string; name: string }[] = [];
  try {
    const [pResult, pSummary, pAnalytics, pStaff] = await Promise.all([
      listSalesPage({ ...filters, page }),
      getSalesSummary(filters),
      getSalesAnalytics(filters),
      db.storeMembership.findMany({
        where: { tenantId: context.tenantId, storeId: context.storeId },
        select: { user: { select: { id: true, name: true } } },
      }),
    ]);
    result = pResult;
    summary = pSummary;
    analytics = pAnalytics;
    cashiers = pStaff.map((s: { user: { id: string; name: string } }) => s.user);
  } catch (err) {
    logError("sales: history load failed", err);
    return <ServiceUnavailableScreen />;
  }

  const carried = {
    q: query || undefined,
    method,
    status,
    from: sp.from,
    to: sp.to,
    cashierId,
    minAmount: sp.minAmount,
    maxAmount: sp.maxAmount,
  };

  return (
    <div className="w-full min-w-0 p-4 sm:p-5">
      <SalesWorkspace
        page={result}
        summary={summary}
        analytics={analytics}
        carriedParams={carried}
        cashiers={cashiers}
        mayReturn={canAuthorizeReturn({
          tenantRole: resolved.context.tenantRole,
          membershipRole: resolved.context.membershipRole,
        })}
      />
    </div>
  );
}

