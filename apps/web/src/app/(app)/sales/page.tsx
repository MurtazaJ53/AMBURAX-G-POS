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
import { PageHeader, LinkButton } from "../_components/ui";
import { SalesWorkspace } from "./_components/SalesWorkspace";

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
    <div className="px-4 py-6 sm:px-6">
      <PageHeader
        title="Sales & Transaction History"
        subtitle={`View, search and manage all your sales and transactions in ${context.storeName}`}
        actions={context.canSell ? <LinkButton href="/pos">New Sale</LinkButton> : undefined}
      />
      <SalesWorkspace
        page={result}
        summary={summary}
        analytics={analytics}
        carriedParams={carried}
      />
    </div>
  );
}
