import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ArrowLeft, ShieldAlert } from "lucide-react";

import { env } from "@/lib/env";
import { resolvePosContext } from "@/server/sales/posContext";
import { getSaleDetail } from "@/server/sales/saleQueries";
import { getReturnedQuantities } from "@/server/sales/returnQueries";
import { canAuthorizeReturn } from "@/server/sales/returnRoles";
import { formatMinor } from "@/server/sales/saleTotals";
import { formatDateTime } from "../../formatDateTime";
import { ReturnForm, type PayoutTill } from "./ReturnForm";
import { canHandleCash, expectedDrawerCash, listOpenSessions } from "@/server/pos/cashRegister";
import { db } from "@/server/db";

/**
 * Refund a bill, in whole or in part.
 *
 * Laid out as the sales screens are — a header that gets you back to the bill, then the lines
 * with what is still returnable, then the refund beside the money summary. Nothing here invents
 * a figure: each line's refund is the server's own proration rule applied to the recorded
 * `lineTotalMinor`, shown so the manager can see what they are approving, and the number written
 * to the ledger is the one the API returns.
 *
 * Authorisation is checked here only so the screen is not a dead end. The decision that counts
 * lives in `createReturn`, which refuses the same caller even if they skip this page entirely.
 */
export default async function CreateReturnPage({ params }: { params: Promise<{ id: string }> }) {
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

  const backHref = `/sales/${sale.id}`;

  // E7: the tills in this store this person may pay a cash refund from, with what each holds.
  const actor = { tenantId: ctx.context.tenantId, userId: ctx.context.userId, tenantRole: ctx.context.tenantRole };
  const open = await listOpenSessions({ tenantId: ctx.context.tenantId, storeId: ctx.context.storeId });
  const tills: PayoutTill[] = [];
  for (const s of open) {
    if (!(await canHandleCash(actor, { cashierUserId: s.cashierUserId, storeId: ctx.context.storeId }))) continue;
    tills.push({
      id: s.id,
      label: `${s.posDevice.name} · ${s.cashier.name}`,
      cashMinor: await expectedDrawerCash(db, ctx.context.tenantId, s.id),
      mine: s.cashierUserId === ctx.context.userId,
    });
  }

  if (!authorised) {
    return (
      <div className="w-full min-w-0 p-4 sm:p-5">
        <Link
          href={backHref}
          className="amb-focus inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-secondary hover:text-primary"
        >
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
          Back to bill {sale.billNumber}
        </Link>
        <h1 className="mt-3 text-[20px] font-bold tracking-[-0.01em] text-primary">Return not permitted</h1>
        <div
          role="alert"
          className="amb-fade-in mt-4 flex max-w-xl items-start gap-3 rounded-lg border border-warning-subtle bg-warning-subtle p-4"
        >
          <ShieldAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <div className="min-w-0 text-[13px] leading-relaxed text-warning">
            <p className="font-semibold">Only a store manager or the owner can authorise a return.</p>
            <p className="mt-1">
              A return puts stock back on the shelf and takes money out of the drawer, so it sits
              with the manager rather than the till. Ask a manager to approve this refund.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (sale.status !== "COMPLETED") {
    return (
      <div className="w-full min-w-0 p-4 sm:p-5">
        <Link
          href={backHref}
          className="amb-focus inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-secondary hover:text-primary"
        >
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
          Back to bill {sale.billNumber}
        </Link>
        <h1 className="mt-3 text-[20px] font-bold tracking-[-0.01em] text-primary">Nothing to return</h1>
        <p role="alert" className="mt-2 max-w-xl text-[13px] text-secondary">
          This bill is {sale.status.toLowerCase()}, so it cannot be returned.
        </p>
      </div>
    );
  }

  const returnedByItem = await getReturnedQuantities({
    tenantId: ctx.context.tenantId,
    saleId: sale.id,
  });

  const lines = sale.items.map((item) => {
    const alreadyReturned = returnedByItem[item.id] ?? 0;
    return {
      id: item.id,
      name: item.name,
      sku: item.sku,
      soldQuantity: item.quantity,
      alreadyReturned,
      returnableQuantity: Math.max(0, item.quantity - alreadyReturned),
      // What the customer paid for the line: its total less its share of any bill discount.
      lineTotalMinor: item.lineTotalMinor - item.lineDiscountMinor,
    };
  });

  const totalPaidMinor = sale.paidMinor;
  const anythingReturnable = lines.some((line) => line.returnableQuantity > 0);

  return (
    <div className="w-full min-w-0 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0">
          <Link
            href={backHref}
            className="amb-focus inline-flex items-center gap-1.5 rounded-md text-[12px] font-medium text-secondary hover:text-primary"
          >
            <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
            Back to bill {sale.billNumber}
          </Link>
          <h1 className="mt-2 text-[20px] font-bold tracking-[-0.01em] text-primary">
            Return against {sale.billNumber}
          </h1>
          <p className="mt-0.5 text-[11px] text-tertiary">
            {formatDateTime(sale.createdAt)} · {sale.storeName} · sold by {sale.cashierName}
          </p>
        </div>
        <dl className="flex shrink-0 gap-5 text-right">
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-tertiary">Bill total</dt>
            <dd className="mt-0.5 font-mono text-[15px] font-semibold tabular-nums text-primary">
              {formatMinor(sale.totalMinor)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-tertiary">Collected</dt>
            <dd className="mt-0.5 font-mono text-[15px] font-semibold tabular-nums text-primary">
              {formatMinor(totalPaidMinor)}
            </dd>
          </div>
        </dl>
      </div>

      {anythingReturnable ? (
        <ReturnForm
          saleId={sale.id}
          billNumber={sale.billNumber}
          lines={lines}
          totalPaidMinor={totalPaidMinor}
          backHref={backHref}
          tills={tills}
        />
      ) : (
        <p role="status" className="mt-5 max-w-xl text-[13px] text-secondary">
          Every line on this bill has already been returned in full. There is nothing left to
          refund.
        </p>
      )}
    </div>
  );
}
