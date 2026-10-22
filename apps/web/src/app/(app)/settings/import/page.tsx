import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { logError } from "@/lib/safeLog";
import { ServiceUnavailableScreen } from "@/app/ServiceUnavailableScreen";
import { resolvePosContext } from "@/server/sales/posContext";
import { aiKeyStatus } from "@/server/ai/aiKey";
import { PageHeader, PermissionDeniedState, buttonClass } from "../../_components/ui";
import { ImportClient } from "./ImportClient";

/** Import data from the shop's previous software (owner). */
export default async function ImportPage() {
  const resolved = await resolvePosContext((await cookies()).get(env.SESSION_COOKIE_NAME)?.value).catch((err: unknown) => {
    logError("import: context failed", err);
    return null;
  });
  if (!resolved) return <ServiceUnavailableScreen />;
  if (resolved.status === "unauthorized") redirect("/auth/login");
  if (resolved.status === "no_store") redirect("/onboarding/business");
  const ctx = resolved.context;
  if (ctx.tenantRole !== "OWNER") {
    return (
      <div className="px-4 py-6 sm:px-6">
        <PageHeader title="Import data" />
        <PermissionDeniedState title="Owner only" description="Only the owner can bring data in from another software." />
      </div>
    );
  }
  const ai = await aiKeyStatus(ctx.tenantId).catch(() => ({ set: false, last4: null, storageReady: false }));
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 lg:p-8">
      <PageHeader
        title="Import data"
        subtitle={`Moving from another software? Bring your customers, products with stock, and past bills into ${ctx.storeName}.`}
        actions={
          <Link href="/sales/imported" className={buttonClass("secondary")}>
            Imported past bills
          </Link>
        }
      />
      <ImportClient aiOn={ai.set} />
    </div>
  );
}
