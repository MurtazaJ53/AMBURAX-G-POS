import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { formatMinor } from "@/server/sales/saleTotals";
import { db } from "@/server/db";
import { getOpenBills } from "@/server/khata/repayment";
import { todayIst } from "@/server/pos/cashRegister";
import { Card, CardHeader, DataTable, PageHeader, PermissionDeniedState, Td, Th } from "../../../_components/ui";
import { formatDateOnly } from "../../../sales/formatDateTime";
import { CollectForm } from "./CollectForm";

/** Collect from one customer (screen 44): their open bills oldest first, and the payment form. */
export default async function CollectPage(props: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await props.params;
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
  let customer: { id: string; name: string } | null;
  let open: Awaited<ReturnType<typeof getOpenBills>>;
  try {
    customer = await db.customer.findFirst({ where: { id: customerId, tenantId: ctx.tenantId }, select: { id: true, name: true } });
    open = customer ? await getOpenBills({ tenantId: ctx.tenantId, storeId: ctx.storeId, customerId: customer.id }) : null;
  } catch (err) {
    logError("khata collect: load failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (!customer) notFound();
  // Overdue = due date before today (India business day), the same rule the till applies.
  const startOfToday = new Date(`${todayIst()}T00:00:00+05:30`);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <PageHeader
        title={`Collect from ${customer.name}`}
        subtitle="Payments settle the oldest bill first. Money over what is owed isn't kept: cash gets change, UPI or card is refused."
        breadcrumb={[
          { label: "Khata", href: "/khata" },
          { label: "Collect", href: "/khata/collect" },
        ]}
      />
      {open === null ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          This store isn&apos;t linked to a company, so it has no khata.
        </p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div>
            {open.bills.length === 0 ? (
              <p className="rounded-xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-600">
                {customer.name} owes nothing here.{" "}
                <Link href={`/customers/${customer.id}`} className="font-semibold text-sky-700 hover:underline">
                  Back to the customer
                </Link>
              </p>
            ) : (
              <DataTable caption="Open bills, oldest first">
                <thead>
                  <tr>
                    <Th>Bill</Th>
                    <Th>Billed</Th>
                    <Th>Due</Th>
                    <Th align="right">Owed</Th>
                  </tr>
                </thead>
                <tbody>
                  {open.bills.map((b, i) => {
                    const overdue = b.dueDate !== null && b.dueDate < startOfToday;
                    return (
                      <tr key={b.saleId}>
                        <Td>
                          <Link
                            href={`/sales/${b.saleId}`}
                            className="amb-focus rounded font-mono text-sm font-semibold text-sky-700 hover:underline"
                          >
                            {b.billNumber}
                          </Link>
                          {i === 0 && <span className="ml-2 text-xs text-slate-500">paid first</span>}
                        </Td>
                        <Td>{formatDateOnly(b.completedAt)}</Td>
                        <Td>
                          {b.dueDate ? (
                            <span className={overdue ? "font-semibold text-rose-700" : ""}>
                              {formatDateOnly(b.dueDate)}
                              {overdue && " · overdue"}
                            </span>
                          ) : (
                            "—"
                          )}
                        </Td>
                        <Td align="right" className="tabular-nums">
                          {formatMinor(b.outstandingMinor)}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </DataTable>
            )}
          </div>
          {open.bills.length > 0 && (
            <Card>
              <CardHeader title="Take payment" subtitle={`Owes ${formatMinor(open.totalMinor)}`} />
              <div className="px-5 pb-5">
                <CollectForm customerId={customer.id} owedMinor={open.totalMinor} />
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
