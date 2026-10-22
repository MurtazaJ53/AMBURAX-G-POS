import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { canManageInventory } from "@/server/inventory/inventoryRoles";
import { listSuppliers } from "@/server/purchasing/suppliers";
import { todayInIndia } from "@/server/purchasing/purchaseOrders";
import { buttonClass, PageHeader, PermissionDeniedState } from "../../../_components/ui";
import { NewOrderForm } from "../OrderForms";

/** New purchase order (screen 47). */
export default async function NewPurchaseOrderPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("purchase orders: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  const breadcrumb = [
    { label: "Purchases", href: "/purchases" },
    { label: "Orders", href: "/purchases/orders" },
  ];
  if (!canManageInventory(ctx)) {
    return (
      <div className="px-4 py-6 sm:px-6">
        <PageHeader title="New order" breadcrumb={breadcrumb} />
        <PermissionDeniedState
          title="You can't place orders for this store"
          description="Ordering stock needs an inventory role."
          hint="Ask a store manager or the owner."
        />
      </div>
    );
  }
  let suppliers: { id: string; name: string }[];
  try {
    suppliers = (await listSuppliers({ tenantId: ctx.tenantId })).map((s) => ({ id: s.id, name: s.name }));
  } catch (err) {
    logError("purchase orders/new: suppliers failed", err);
    return <ServiceUnavailableScreen />;
  }
  const minDate = todayInIndia();

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <PageHeader title="New order" subtitle={`Order stock for ${ctx.storeName}.`} breadcrumb={breadcrumb} />
      {suppliers.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center">
          <p className="text-sm font-semibold text-slate-900">Add a supplier first</p>
          <p className="mt-1 text-sm text-slate-500">An order is always with an active supplier.</p>
          <Link href="/suppliers" className={`${buttonClass("primary")} mt-4`}>
            Go to suppliers
          </Link>
        </div>
      ) : (
        <NewOrderForm suppliers={suppliers} minDate={minDate} />
      )}
    </div>
  );
}
