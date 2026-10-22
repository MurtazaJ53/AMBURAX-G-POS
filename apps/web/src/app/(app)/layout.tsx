import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { resolvePosContext, type PosContext } from "@/server/sales/posContext";
import { getTenantCapabilities } from "@/server/tenant/capabilities";
import { getShiftActivity } from "@/server/dashboard/dashboardQueries";
import { listAvailableStores } from "@/server/tenant/storeSelection";
import { db } from "@/server/db";
import { AppShell } from "@/components/shell/AppShell";
import type { StoreOption } from "@/components/shell/StoreSwitcher";

/**
 * The AMBURAX application shell.
 *
 * Every workspace screen renders inside this: persistent left navigation, a top
 * application bar carrying store and user context, and a scrollable workspace. Screens
 * supply only their own content, which is what keeps the product feeling like one system
 * rather than a set of separate pages.
 */

function roleLabel(context: PosContext): string {
  if (context.tenantRole === "OWNER") return "Owner";
  switch (context.membershipRole) {
    case "STORE_MANAGER":
      return "Store Manager";
    case "SALES_ASSOCIATE":
      return "Sales Associate";
    case "CASHIER":
      return "Cashier";
    case "INVENTORY_MANAGER":
      return "Inventory Manager";
    case "ACCOUNTANT":
      return "Accountant";
    case null:
      return "No store role";
    default:
      return context.membershipRole;
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;

  let context: PosContext | null = null;
  let capabilities: string[] = [];
  let tenantName: string | undefined;
  let tillOpen = false;
  let allowedModules: string[] | null = null;
  let availableStores: StoreOption[] = [];

  try {
    const resolved = await resolvePosContext(token);
    if (resolved.status === "ok") {
      context = resolved.context;
      // The shell's identity and its one live signal. Fetched together, and deliberately
      // cheap: a name and a count, not a dashboard's worth of aggregates on every route.
      const { getUserAllowedModules } = await import("@/server/identity/staffPermissionsService");
      const [caps, tenant, activity, customMods, stores] = await Promise.all([
        getTenantCapabilities(context.tenantId),
        db.tenant.findUnique({
          where: { id: context.tenantId },
          select: { name: true },
        }),
        getShiftActivity({ tenantId: context.tenantId, storeId: context.storeId }),
        context.tenantRole === "OWNER" ? Promise.resolve(null) : getUserAllowedModules(context.tenantId, context.userId),
        listAvailableStores({
          tenantId: context.tenantId,
          userId: context.userId,
          tenantRole: context.tenantRole,
        }),
      ]);
      capabilities = caps;
      tenantName = tenant?.name;
      tillOpen = activity.openSessions > 0;
      allowedModules = customMods;
      availableStores = stores.map((s) => ({
        id: s.id,
        name: s.name,
        code: s.code,
        city: s.city,
        state: s.state,
        isDefault: s.isDefault,
      }));
    }
  } catch (err) {
    logError("app layout: context resolution failed", err);
  }

  if (!context) return <>{children}</>;

  return (
    <AppShell
      tenantCapabilities={capabilities}
      tenantName={tenantName}
      storeName={context.storeName}
      storeCode={context.storeCode}
      storeId={context.storeId}
      availableStores={availableStores}
      userName={context.userName}
      roleLabel={roleLabel(context)}
      canSell={context.canSell}
      tillOpen={tillOpen}
      allowedModules={allowedModules}
    >
      {children}
    </AppShell>
  );
}
