import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext } from "@/server/sales/posContext";
import { aiKeyStatus } from "@/server/ai/aiKey";
import { gatherBusinessGrounding } from "@/server/ai/grounding";
import { PageHeader } from "../_components/ui";
import { AiCommandCenterClient } from "./AiCommandCenterClient";

export default async function AiPage() {
  const token = (await cookies()).get(env.SESSION_COOKIE_NAME)?.value;
  let resolved;
  try {
    resolved = await resolvePosContext(token);
  } catch (err) {
    logError("ai: context failed", err);
    return <ServiceUnavailableScreen />;
  }

  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");

  const ctx = resolved.context;
  const [ai, facts] = await Promise.all([
    aiKeyStatus(ctx.tenantId).catch(() => ({
      set: false,
      last4: null,
      geminiSet: false,
      geminiLast4: null,
      openaiSet: false,
      openaiLast4: null,
      storageReady: false,
    })),
    gatherBusinessGrounding({ tenantId: ctx.tenantId, storeId: ctx.storeId }),
  ]);

  const hasAnyKey = Boolean(ai.set || ai.geminiSet || ai.openaiSet);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 lg:p-8">
      <PageHeader
        title="AI Command Center"
        subtitle={`Grounded business intelligence, morning briefings, and policy-guarded action drafts for ${ctx.storeName}.`}
      />
      <AiCommandCenterClient initialFacts={facts} hasAiKey={hasAnyKey} />
    </div>
  );
}
