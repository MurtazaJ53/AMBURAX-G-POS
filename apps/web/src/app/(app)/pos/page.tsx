import { db } from "@/server/db";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { PosTerminal } from "./PosTerminal";
import { DEFAULT_APPAREL_SLAB, getApparelSlab } from "@/server/tax/taxSettings";
import { listApprovers } from "@/server/identity/approvalPin";
import { PermissionDeniedState } from "../_components/ui";

/**
 * The till.
 *
 * Authorization is decided here, on the server, before any of the terminal is sent to the
 * browser: a user who may not sell never receives the selling UI at all. The API re-checks
 * the same thing on every request regardless — this guard is for the operator's clarity,
 * not for security.
 *
 * Renders inside the (app) shell, so the persistent sidebar and top bar remain visible
 * around the till, matching the design reference.
 */
export default async function PosPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;

  // Only the data load is wrapped. redirect() below is implemented by throwing, so
  // catching around it would swallow the navigation.
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("pos: context resolution failed", err);
    return <ServiceUnavailableScreen />;
  }

  if (resolved.status === "unauthorized") {
    redirect("/auth/login");
  }

  // A tenant with no store has not finished onboarding. /home owns that decision, so send
  // the user there rather than duplicating the resume logic in a second place.
  if (resolved.status === "no_store") {
    redirect("/dashboard");
  }

  const context = resolved.context;

  if (!context.canSell) {
    return (
      <div className="mx-auto max-w-xl px-6 py-16">
        <PermissionDeniedState
          title="You can't sell in this store"
          description={`Your role in ${context.storeName} doesn't include taking payments. Ask an owner or store manager to change your access.`}
          hint={`Signed in as ${context.userName} · ${context.membershipRole ?? "no store role"}`}
        />
      </div>
    );
  }

  // The slab is read here so the till's preview uses the same rates the server will charge.
  // A failed read falls back to the defaults the server would also use for an unset tenant.
  const slab = await getApparelSlab(context.tenantId).catch(() => DEFAULT_APPAREL_SLAB);
  const mayGiveLargeDiscount = context.tenantRole === "OWNER" || context.membershipRole === "STORE_MANAGER";
  // No GSTIN = not GST-registered: NON_GST items sell at 0% (same rule as createSale). On a lookup
  // failure assume registered, so the till errs towards refusing rather than mis-taxing.
  const gstRegistered = await db.tenant
    .findUnique({ where: { id: context.tenantId }, select: { taxId: true } })
    .then((t) => Boolean(t?.taxId?.trim()))
    .catch(() => true);
  // Who can approve a cashier's larger discount with their PIN. Not needed for a manager's own till.
  const approvers = mayGiveLargeDiscount
    ? []
    : await listApprovers({ tenantId: context.tenantId, storeId: context.storeId }).catch(() => []);

  return (
    <PosTerminal
      storeName={context.storeName}
      storeCode={context.storeCode}
      cashierName={context.userName}
      slab={slab}
      mayGiveLargeDiscount={mayGiveLargeDiscount}
      approvers={approvers}
      gstRegistered={gstRegistered}
    />
  );
}
