import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { DEFAULT_PROGRAM, getProgram } from "@/server/loyalty/loyalty";
import { Card, CardHeader, PageHeader, PermissionDeniedState, StatusBadge } from "../_components/ui";
import { LoyaltySettings } from "../settings/LoyaltySettings";
import { OffersManager } from "./OffersManager";

/**
 * Offers & Loyalty. Loyalty configuration (screen 59) lives here; it stays OFF until finance and the
 * GST reviewer sign off. Offers and pricing rules (56-58) wait on their decisions (latter.md).
 */
export default async function OffersPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("offers: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  if (ctx.tenantRole !== "OWNER") {
    return (
      <div className="px-4 py-6 sm:px-6">
        <PageHeader title="Offers & Loyalty" />
        <PermissionDeniedState title="Offers and loyalty are set by the owner" description="They change what customers pay." />
      </div>
    );
  }
  let program: Awaited<ReturnType<typeof getProgram>>;
  try {
    program = await getProgram(ctx.tenantId);
  } catch (err) {
    logError("offers: load failed", err);
    return <ServiceUnavailableScreen />;
  }
  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      <PageHeader title="Offers & Loyalty" subtitle="Loyalty rules now; offers once their rules are decided." />
      <div className="amb-fade-in">
        <OffersManager />
      </div>
      <div className="amb-fade-in">
        <LoyaltySettings rules={program ?? DEFAULT_PROGRAM} saved={program !== null} />
      </div>
    </div>
  );
}
