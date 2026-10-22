import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext, type PosContextResult } from "@/server/sales/posContext";
import { getPosConfig } from "@/server/pos/posConfig";
import { Card, CardHeader, PageHeader } from "../../_components/ui";
import { PosConfigForm } from "./PosConfigForm";
import { ReceiptCustomizer } from "./ReceiptCustomizer";
import { PrinterTestBench } from "@/client/hardware/PrinterTestBench";

/**
 * POS configuration for this store: attendance rules, receipt layout, thermal printer setup, and hardware diagnostics.
 */
export default async function PosConfigPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved: PosContextResult;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("pos config: context failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;

  let config: Awaited<ReturnType<typeof getPosConfig>>;
  try {
    config = await getPosConfig(ctx.tenantId, ctx.storeId);
  } catch (err) {
    logError("pos config: load failed", err);
    return <ServiceUnavailableScreen />;
  }
  if (!config) return <ServiceUnavailableScreen />;
  const isOwner = ctx.tenantRole === "OWNER";

  return (
    <div className="space-y-6 px-4 py-6 sm:px-6">
      <PageHeader
        title="POS & Hardware configuration"
        subtitle={ctx.storeName}
        breadcrumb={[{ label: "Settings", href: "/settings" }]}
      />

      <Card className="amb-fade-in">
        <CardHeader
          title="Till and attendance rules"
          subtitle={isOwner ? "Changes are recorded in the audit log." : "Only the owner can change these."}
        />
        <div className="px-5 pb-5">
          <PosConfigForm {...config} canEdit={isOwner} />
        </div>
      </Card>

      <Card className="amb-fade-in">
        <CardHeader
          title="Thermal Receipt Customizer & Layout"
          subtitle="Configure customer header, return policies, e-Bill QR codes, and default paper width."
        />
        <div className="px-5 pb-5">
          <ReceiptCustomizer storeName={ctx.storeName} canEdit={isOwner} />
        </div>
      </Card>

      <div className="amb-fade-in">
        <PrinterTestBench />
      </div>
    </div>
  );
}
