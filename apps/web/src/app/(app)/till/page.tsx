import { db } from "@/server/db";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContext, type PosContextResult } from "@/server/sales/posContext";
import { TillWorkspace } from "./_components/TillWorkspace";

/**
 * The till.
 *
 * Authorization is decided here, on the server, before any of the command surface is sent to
 * the browser: a user who may not sell never receives the selling UI. The API re-checks the
 * same predicate on every request regardless — this guard exists for the operator's clarity,
 * not as the enforcement point.
 *
 * Nothing about the tenant reaches the client. The workspace receives a user id (its own), a
 * display name, a role label and the store's name and code — enough to tell a cashier where
 * they are, and not enough to name a tenant or address one.
 */

/** The two authorization axes, turned into something a person recognises (PERMISSIONS.md). */
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

export default async function TillPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;

  // Only the data load is wrapped. redirect() is implemented by throwing, so catching around
  // it would swallow the navigation.
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("till: context resolution failed", err);
    return <ServiceUnavailableScreen />;
  }

  if (resolved.status === "unauthorized") redirect("/auth/login");
  // A tenant with no store has not finished onboarding; /home owns that decision.
  if (resolved.status === "no_store") redirect("/dashboard");

  const context = resolved.context;
  // No GSTIN = not GST-registered, the same rule as createSale. A boolean, not the GSTIN, crosses
  // to the client. On a lookup failure assume registered: the server stays the authority.
  const gstRegistered = await db.tenant
    .findUnique({ where: { id: context.tenantId }, select: { taxId: true } })
    .then((t) => Boolean(t?.taxId?.trim()))
    .catch(() => true);

  if (!context.canSell) {
    return (
      <div data-amburax className="mx-auto max-w-xl px-6 py-16">
        <div className="rounded-amb-lg border border-amb-line bg-amb-raised p-6 shadow-amb">
          <h1 className="text-lg font-semibold text-amb-ink">You can&apos;t sell in this store</h1>
          <p className="mt-2 text-sm text-amb-ink-secondary">
            Your role in {context.storeName} doesn&apos;t include taking payments. Ask an owner or
            store manager to change your access.
          </p>
          <p className="mt-4 text-xs text-amb-ink-muted">
            Signed in as {context.userName} · {roleLabel(context)}
          </p>
        </div>
      </div>
    );
  }

  return (
    <TillWorkspace
      currentUserId={context.userId}
      cashierName={context.userName}
      roleLabel={roleLabel(context)}
      storeName={context.storeName}
      storeCode={context.storeCode}
      gstRegistered={gstRegistered}
    />
  );
}
