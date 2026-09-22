import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
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

const PAYMENT_METHODS = ["CASH", "UPI", "CARD"] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

function parseMethod(value: string | undefined): PaymentMethod | undefined {
  return PAYMENT_METHODS.includes(value as PaymentMethod) ? (value as PaymentMethod) : undefined;
}

function parseStatus(value: string | undefined): "COMPLETED" | "VOIDED" | undefined {
  return value === "COMPLETED" || value === "VOIDED" ? value : undefined;
}

function parseDate(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const base = Date.UTC(y!, m! - 1, d!, 0, 0, 0) - IST_OFFSET_MS;
  return new Date(endOfDay ? base + 24 * 60 * 60 * 1000 : base);
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; method?: string; status?: string; from?: string; to?: string; page?: string }>;
}) {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  const sp = await searchParams;

  const query = (sp.q ?? "").slice(0, 100);
  const method = parseMethod(sp.method);
  const status = parseStatus(sp.status);
  const from = parseDate(sp.from);
  const to = parseDate(sp.to, true);
  const page = Number.parseInt(sp.page ?? "1", 10) || 1;

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

  const filters = { tenantId: context.tenantId, storeId: context.storeId, query, method, status, from, to };

  let result: SalesPage;
  let summary: SalesSummary;
  let analytics: SalesAnalytics;
  try {
    [result, summary, analytics] = await Promise.all([
      listSalesPage({ ...filters, page }),
      getSalesSummary(filters),
      getSalesAnalytics(filters),
    ]);
  } catch (err) {
    logError("sales: history load failed", err);
    return <ServiceUnavailableScreen />;
  }

  const carried = { q: query || undefined, method, status, from: sp.from, to: sp.to };

  return (
    <div className="flex w-full flex-col p-5 max-w-[1600px] mx-auto">
      {/* Custom Header matching the reference density */}
      <div className="mb-5 flex flex-col sm:flex-row sm:items-center sm:justify-between shrink-0">
        <div>
          <h1 className="text-[25px] font-bold text-slate-900 leading-tight tracking-tight">Sales & Transaction History</h1>
          <p className="text-[14.5px] text-slate-500 mt-0.5">View, search and manage all your sales, returns and transactions</p>
        </div>
        <div className="mt-3 sm:mt-0">
          <Link href="/sales/export" className="inline-flex items-center justify-center rounded h-8 px-3 text-[12px] font-medium bg-white text-slate-600 shadow-sm border border-slate-200 hover:bg-slate-50">
             <Download size={14} className="mr-1.5" /> Export
          </Link>
        </div>
      </div>

      <SalesWorkspace
        page={result}
        summary={summary}
        analytics={analytics}
        carriedParams={carried}
      />
    </div>
  );
}
