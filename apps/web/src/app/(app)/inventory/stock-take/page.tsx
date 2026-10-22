import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { canManageInventory } from "@/server/inventory/inventoryRoles";
import { COUNT_SHEET_LIMIT, getCountSheet, type CountSheetRow } from "@/server/inventory/countSheet";
import { PageHeader, PermissionDeniedState, SearchForm } from "../../_components/ui";
import { CountSheetForm } from "./CountSheetForm";

/** Stock take / physical count (screen 31) for the current store. */
export default async function StockTakePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = ((await searchParams).q ?? "").slice(0, 100);
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("stock-take: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;
  const breadcrumb = [{ label: "Inventory", href: "/inventory" }];

  if (!canManageInventory(ctx)) {
    return (
      <div className="px-4 py-6 sm:px-6">
        <PageHeader title="Stock take" breadcrumb={breadcrumb} />
        <PermissionDeniedState
          title="You can't record stock counts here"
          description="A count corrects the store's stock, so it needs an inventory role in this store."
        />
      </div>
    );
  }

  let rows: CountSheetRow[];
  try {
    rows = await getCountSheet({ tenantId: ctx.tenantId, storeId: ctx.storeId, search: query });
  } catch (err) {
    logError("stock-take: load failed", err);
    return <ServiceUnavailableScreen />;
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Stock take"
        subtitle={`Count what is on the shelf in ${ctx.storeName}. Differences correct the stock and are recorded.`}
        breadcrumb={breadcrumb}
      />
      <div className="mb-4 max-w-xl">
        <SearchForm
          action="/inventory/stock-take"
          label="Find items to count"
          placeholder="Name, SKU or scan a barcode"
          defaultValue={query}
        />
      </div>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-600">
          {query ? `No item matches "${query}".` : "No active products to count yet."}
        </p>
      ) : (
        <>
          {rows.length === COUNT_SHEET_LIMIT && (
            <p className="mb-3 text-sm text-slate-600">
              Showing the first {COUNT_SHEET_LIMIT} items. Search to count a specific group.
            </p>
          )}
          <CountSheetForm key={query} rows={rows} />
        </>
      )}
    </div>
  );
}
