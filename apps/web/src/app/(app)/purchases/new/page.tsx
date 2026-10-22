import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { canManageInventory } from "@/server/inventory/inventoryRoles";
import { listSuppliers } from "@/server/purchasing/suppliers";
import { buttonClass, PageHeader, PermissionDeniedState } from "../../_components/ui";
import { NewPurchaseForm } from "../NewPurchaseForm";

export default async function NewPurchasePage() {
  // Read outside the try: cookies() is how Next learns this page is per-user, and catching around
  // it would hide that signal and let the build pre-render the error screen.
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("purchases/new: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  const breadcrumb = [{ label: "Purchases", href: "/purchases" }];
  if (!canManageInventory(ctx)) {
    return (
      <div className="px-4 py-6 sm:px-6">
        <PageHeader title="New purchase" breadcrumb={breadcrumb} />
        <PermissionDeniedState
          title="You can't receive stock in this store"
          description="Recording a purchase adds stock, so it needs an inventory role."
          hint="Ask a store manager or the owner."
        />
      </div>
    );
  }

  let suppliers: { id: string; name: string }[];
  try {
    suppliers = (await listSuppliers({ tenantId: ctx.tenantId })).map((s) => ({ id: s.id, name: s.name }));
  } catch (err) {
    logError("purchases/new: suppliers failed", err);
    return <ServiceUnavailableScreen />;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <PageHeader
        title="New purchase"
        subtitle={`Goods arriving at ${ctx.storeName}. Enter each item's cost excluding GST.`}
        breadcrumb={breadcrumb}
      />
      {suppliers.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center">
          <p className="text-sm font-semibold text-slate-900">Add a supplier first</p>
          <p className="mt-1 text-sm text-slate-500">A purchase is always from an active supplier.</p>
          <Link href="/suppliers" className={`${buttonClass("primary")} mt-4`}>
            Go to suppliers
          </Link>
        </div>
      ) : (
        <NewPurchaseForm suppliers={suppliers} canCreateProducts={ctx.tenantRole === "OWNER"} />
      )}
    </div>
  );
}
