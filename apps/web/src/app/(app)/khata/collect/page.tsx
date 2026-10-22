import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { formatMinor } from "@/server/sales/saleTotals";
import { HandCoins } from "lucide-react";
import { listDebtors } from "@/server/khata/repayment";
import { DataTable, EmptyState, PageHeader, PermissionDeniedState, Td, Th } from "../../_components/ui";

/** Collect dues (screen 44): everyone who owes in this store's company, largest first. */
export default async function CollectListPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("khata collect: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  if (!ctx.canSell) {
    return (
      <div className="px-4 py-6 sm:px-6">
        <PageHeader title="Collect payment" breadcrumb={[{ label: "Khata", href: "/khata" }]} />
        <PermissionDeniedState title="You can't take payments here" description="Collecting dues needs a selling role in this store." />
      </div>
    );
  }
  let debtors: Awaited<ReturnType<typeof listDebtors>>;
  try {
    debtors = await listDebtors({ tenantId: ctx.tenantId, storeId: ctx.storeId });
  } catch (err) {
    logError("khata collect: list failed", err);
    return <ServiceUnavailableScreen />;
  }
  return (
    <div className="px-4 py-6 sm:px-6">
      <PageHeader
        title="Collect payment"
        subtitle="Customers who owe in this store's company. A payment settles their oldest bill first."
        breadcrumb={[{ label: "Khata", href: "/khata" }]}
      />
      {debtors === null ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          This store isn&apos;t linked to a company, so it has no khata.
        </p>
      ) : debtors.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          <EmptyState icon={<HandCoins className="h-5 w-5" />} title="Nobody owes anything" description="Udhar given at the till shows up here." />
        </div>
      ) : (
        <DataTable caption="Customers who owe">
          <thead>
            <tr>
              <Th>Customer</Th>
              <Th align="right">Bills</Th>
              <Th align="right">Owes</Th>
              <Th align="right">
                <span className="sr-only">Collect</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {debtors.map((d) => (
              <tr key={d.customerId}>
                <Td className="font-medium text-slate-900">{d.name}</Td>
                <Td align="right" className="tabular-nums">
                  {d.bills}
                </Td>
                <Td align="right" className="font-semibold tabular-nums text-slate-900">
                  {formatMinor(d.owedMinor)}
                </Td>
                <Td align="right">
                  <Link
                    href={`/khata/collect/${d.customerId}`}
                    className="amb-focus inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-semibold text-sky-700 hover:bg-sky-50"
                  >
                    Collect
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
