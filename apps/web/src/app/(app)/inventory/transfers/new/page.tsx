import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { db } from "@/server/db";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { hasInventoryRightsIn } from "@/server/inventory/stockTransfers";
import { PageHeader, PermissionDeniedState } from "../../../_components/ui";
import { NewTransferForm } from "../TransferForms";

/** Send stock from the current store to another store of the business (screen 28). */
export default async function NewTransferPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("transfers/new: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;
  const breadcrumb = [
    { label: "Inventory", href: "/inventory" },
    { label: "Transfers", href: "/inventory/transfers" },
  ];

  let allowed: boolean;
  let stores: { id: string; name: string; code: string }[];
  try {
    [allowed, stores] = await Promise.all([
      hasInventoryRightsIn({ tenantId: ctx.tenantId, userId: ctx.userId, tenantRole: ctx.tenantRole }, ctx.storeId),
      db.store.findMany({
        where: { tenantId: ctx.tenantId, id: { not: ctx.storeId } },
        orderBy: { name: "asc" },
        select: { id: true, name: true, code: true },
      }),
    ]);
  } catch (err) {
    logError("transfers/new: load failed", err);
    return <ServiceUnavailableScreen />;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <PageHeader title="New transfer" subtitle={`Sending from ${ctx.storeName}.`} breadcrumb={breadcrumb} />
      {!allowed ? (
        <PermissionDeniedState
          title="You can't send stock from this store"
          description="Sending a transfer takes stock out of this store, so it needs an inventory role here."
        />
      ) : stores.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-600">
          There is no other store to send to yet.
        </p>
      ) : (
        <NewTransferForm stores={stores} />
      )}
    </div>
  );
}
