import { redirect, notFound } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { resolvePosContext } from "@/server/sales/posContext";
import { getSaleDetail } from "@/server/sales/saleQueries";
import { getReturnedQuantities } from "@/server/sales/returnQueries";
import { canAuthorizeReturn } from "@/server/sales/returnRoles";
import { ExchangeClient } from "./ExchangeClient";

export const metadata = {
  title: "Process Exchange — AMBURAX POS",
};

export default async function ExchangePage({ params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  const resolvedParams = await params;
  const token = cookieStore.get(env.SESSION_COOKIE_NAME)?.value;
  if (!token) return redirect("/auth/login");

  const ctx = await resolvePosContext(token);
  if (ctx.status !== "ok") return redirect("/auth/login");

  const sale = await getSaleDetail({ tenantId: ctx.context.tenantId, saleId: resolvedParams.id });
  if (!sale) notFound();

  const authorised = canAuthorizeReturn({
    tenantRole: ctx.context.tenantRole,
    membershipRole: ctx.context.membershipRole,
  });

  if (!authorised) {
    redirect(`/sales/${sale.id}`);
  }

  const alreadyReturned = await getReturnedQuantities({
    tenantId: ctx.context.tenantId,
    saleId: sale.id,
  });

  const returnableLines = sale.items.map((i) => {
    const ret = alreadyReturned[i.id] ?? 0;
    return {
      id: i.id,
      name: i.name,
      sku: i.sku,
      unitPriceMinor: i.unitPriceMinor,
      lineTotalMinor: i.lineTotalMinor,
      soldQuantity: i.quantity,
      alreadyReturned: ret,
      returnableQuantity: Math.max(0, i.quantity - ret),
    };
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <ExchangeClient
        saleId={sale.id}
        billNumber={sale.billNumber}
        customerName={sale.customer?.name ?? null}
        returnableLines={returnableLines}
      />
    </div>
  );
}
