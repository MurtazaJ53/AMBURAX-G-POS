import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { db } from "@/server/db";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext } from "@/server/sales/posContext";
import { formatMinor } from "@/server/sales/saleTotals";
import { DataTable, EmptyState, PageHeader, Td, Th, buttonClass } from "../../_components/ui";

/**
 * Bills brought over from the shop's previous software. History only: they never moved stock here
 * and are not in today's sales, reports of AMBURAX bills, or ERPNext.
 */
export default async function ImportedSalesPage(props: { searchParams: Promise<{ q?: string }> }) {
  const resolved = await resolvePosContext((await cookies()).get(env.SESSION_COOKIE_NAME)?.value).catch((err: unknown) => {
    logError("imported sales: context failed", err);
    return null;
  });
  if (!resolved) return <ServiceUnavailableScreen />;
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;
  const q = (await props.searchParams).q?.trim() ?? "";

  let data;
  try {
    const where = {
      tenantId: ctx.tenantId,
      storeId: ctx.storeId,
      ...(q
        ? {
            OR: [
              { billNumber: { contains: q, mode: "insensitive" as const } },
              { customerName: { contains: q, mode: "insensitive" as const } },
              { customerPhone: { contains: q } },
            ],
          }
        : {}),
    };
    const [rows, agg] = await Promise.all([
      db.importedSale.findMany({ where, orderBy: { soldAt: "desc" }, take: 200 }),
      db.importedSale.aggregate({ where, _count: true, _sum: { totalMinor: true } }),
    ]);
    data = { rows, count: agg._count, total: agg._sum.totalMinor ?? 0 };
  } catch (err) {
    logError("imported sales: load failed", err);
    return <ServiceUnavailableScreen />;
  }

  return (
    <div className="space-y-5 px-4 py-6 sm:px-6">
      <PageHeader
        title="Imported past bills"
        subtitle={`${data.count.toLocaleString("en-IN")} bills from your previous software · ${formatMinor(data.total)} in total. History only — not part of today's sales or stock.`}
        actions={
          ctx.tenantRole === "OWNER" ? (
            <Link href="/settings/import" className={buttonClass("secondary")}>
              Import more
            </Link>
          ) : undefined
        }
      />
      <form className="max-w-md">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Bill number, customer or mobile, then Enter"
          aria-label="Search imported bills"
          className="amb-focus block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
        />
      </form>
      {data.rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white">
          <EmptyState
            title={q ? "Nothing matches" : "No imported bills yet"}
            description={q ? "Try another bill number or name." : "Bring old bills in from Settings → Import data."}
          />
        </div>
      ) : (
        <DataTable caption="Imported past bills">
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Bill</Th>
              <Th>Customer</Th>
              <Th>Items</Th>
              <Th>Paid by</Th>
              <Th align="right">GST</Th>
              <Th align="right">Total</Th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id}>
                <Td>{r.soldAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</Td>
                <Td className="font-medium text-slate-900">{r.billNumber}</Td>
                <Td>
                  {r.customerId ? (
                    <Link href={`/customers/${r.customerId}`} className="text-sky-700 hover:underline">
                      {r.customerName}
                    </Link>
                  ) : (
                    (r.customerName ?? "Walk-in")
                  )}
                  {r.customerPhone ? <span className="block text-xs text-slate-500">{r.customerPhone}</span> : null}
                </Td>
                <Td className="max-w-[260px] truncate text-slate-600">{r.itemsText ?? "—"}</Td>
                <Td>{r.paymentMode ?? "—"}</Td>
                <Td align="right">{formatMinor(r.taxMinor)}</Td>
                <Td align="right" className="font-semibold text-slate-900">
                  {formatMinor(r.totalMinor)}
                </Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </div>
  );
}
